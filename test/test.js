'use strict';

// Offline-only regression checks. External modules, network, timers and hardware
// are stubbed; importing a hardware driver is deliberately not permitted.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const { isLocalRequest } = require('../backend/requestPolicy');
const root = path.resolve(__dirname, '..');
const logger = { info() {}, warn() {}, error() {} };
const winston = {
  createLogger: () => logger,
  format: { simple() {}, combine() {}, timestamp() {}, printf() {} },
  transports: { File: class {}, Console: class {} }
};

function load(relative, overrides = {}) {
  const file = path.join(root, relative);
  const module = { exports: {} };
  const stubs = { events: EventEmitter, mathjs: {}, winston, ...overrides };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(file),
    require(name) {
      if (!(name in stubs)) throw new Error(`Unexpected dependency in offline test: ${name}`);
      return stubs[name];
    },
    setInterval: () => 1, clearInterval() {}, setTimeout,
    console: { log() {} }, process: { env: {} }
  }, { filename: file });
  return module.exports;
}

const Kinematics = class {
  forwardKinematics() { return { position: { x: 0, y: 0, z: 0 }, orientation: { rx: 0, ry: 0, rz: 0 } }; }
  inverseKinematics() { return [[0, 0, 0, 0, 0, 0]]; }
};
const RobotController = load('backend/controllers/RobotController.js', { './Kinematics': Kinematics });
const SafetyMonitor = load('backend/controllers/SafetyMonitor.js');
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
async function simulatedRobot() { const robot = new RobotController(); await robot.initialize(); return robot; }

test('connection method remains callable before and after initialization', async () => {
  const robot = new RobotController();
  assert.strictEqual(robot.isConnected(), false);
  await robot.initialize();
  assert.strictEqual(robot.isConnected(), true);
  assert.strictEqual(robot.simulationMode, true);
  assert.strictEqual(robot.ethercatMaster, null);
  await robot.close();
  assert.strictEqual(robot.isConnected(), false);
});

test('hardware initialization and motion fail closed', async () => {
  const robot = await simulatedRobot();
  await assert.rejects(robot.initHardwareEtherCAT(), /disabled/);
  robot.simulationMode = false;
  await assert.rejects(robot.moveJoints([0, 0, 0, 0, 0, 0]), /Hardware motion is disabled/);
  assert.deepStrictEqual(Array.from(robot.targetJoints), [0, 0, 0, 0, 0, 0]);
});

test('malformed joint commands do not modify targets', async () => {
  const robot = await simulatedRobot();
  for (const args of [[-1, 0], [6, 0], [0.5, 0], [0, NaN], [0, '0'], [0, Infinity], [0, null]]) {
    await assert.rejects(robot.moveJoint(...args), /exceeds limits/);
  }
  for (const joints of [null, {}, [], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0, NaN]]) {
    await assert.rejects(robot.moveJoints(joints));
  }
  assert.deepStrictEqual(Array.from(robot.targetJoints), [0, 0, 0, 0, 0, 0]);
});

test('invalid speed and Cartesian values are rejected', async () => {
  const robot = await simulatedRobot();
  for (const speed of [0, -1, 101, NaN, Infinity, '50']) {
    await assert.rejects(robot.moveJoint(0, 0, speed), /Speed/);
  }
  await assert.rejects(robot.moveToCartesian(NaN, 0, 0), /finite/);
  await robot.moveJoint(0, 0);
});

test('emergency stop stays latched and interrupts a trajectory', async () => {
  const robot = await simulatedRobot();
  robot.emergencyStop();
  await assert.rejects(robot.moveJoint(0, 0), /latched/);
  await assert.rejects(robot.moveJoints([0, 0, 0, 0, 0, 0]), /latched/);
  await assert.rejects(robot.waitForMovementComplete(), /interrupted/);
  assert.strictEqual(robot.isMoving, false);
});

test('movement timeout is an error and latches stop', async () => {
  const robot = await simulatedRobot();
  robot.targetJoints[0] = 1;
  await assert.rejects(robot.waitForMovementComplete(1), /timed out/);
  assert.strictEqual(robot.emergencyStopped, true);
  assert.strictEqual(robot.targetJoints[0], robot.currentJoints[0]);
});

test('concurrent commands are rejected', async () => {
  const robot = await simulatedRobot();
  robot.isMoving = true;
  await assert.rejects(robot.moveJoint(0, 0), /already in progress/);
});

test('safety monitor is deterministic in simulation and rejects missing hardware feedback', async () => {
  const robot = await simulatedRobot();
  const monitor = new SafetyMonitor(robot);
  assert.strictEqual(monitor.isActive(), true);
  for (let i = 0; i < 100; i++) assert.strictEqual(monitor.checkCollision(), false);
  assert.strictEqual(monitor.getStatus().robotConnected, true);
  robot.simulationMode = false;
  assert.throws(() => monitor.checkCollision(), /telemetry/);
});

test('invalid safety feedback triggers protective stop', async () => {
  const robot = await simulatedRobot();
  const monitor = new SafetyMonitor(robot);
  assert.strictEqual(monitor.checkJointLimits([NaN, 0, 0, 0, 0, 0]), false);
  assert.strictEqual(robot.emergencyStopped, true);
  assert.strictEqual(monitor.getStatus().emergencyStopped, true);
});

test('request policy accepts only local same-origin requests', () => {
  const request = headers => ({ headers, socket: { localPort: 3000 } });
  assert.strictEqual(isLocalRequest(request({ host: 'localhost:3000', origin: 'http://localhost:3000' })), true);
  assert.strictEqual(isLocalRequest(request({ host: '127.0.0.1:3000' })), true);
  for (const headers of [{ host: 'example.org:3000' }, { host: 'localhost:3000', origin: 'https://example.org' }, { host: 'localhost:3000', origin: 'null' }, { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }, { host: 'localhost:3001' }, {}]) {
    assert.strictEqual(isLocalRequest(request(headers)), false);
  }
});

test('unsupported trajectories fail before sending any motion', async () => {
  const Planner = load('backend/controllers/MotionPlanner.js');
  const planner = new Planner();
  let moves = 0;
  const robot = { async moveJoints() { moves++; } };
  await assert.rejects(planner.executeTrajectory(robot, [{ x: 1, y: 2, z: 3 }]), /not implemented/);
  await assert.rejects(planner.executeTrajectory(robot, []), /not implemented/);
  assert.strictEqual(moves, 0);
  await planner.executeTrajectory(robot, [{ position: [0, 0, 0, 0, 0, 0] }]);
  assert.strictEqual(moves, 1);
});

test('server waits for initialization and binds loopback only', async () => {
  const routes = {};
  const app = { use() {}, get(route, fn) { routes[route] = fn; }, post() {} };
  const express = () => app;
  express.json = express.static = () => () => {};
  let listenArgs;
  const server = { listen(...args) { listenArgs = args; } };
  let initialized = false;
  class FakeRobot extends RobotController {
    async initialize() { await Promise.resolve(); await super.initialize(); initialized = true; }
  }
  const Server = load('backend/server.js', {
    express, http: { createServer: () => server },
    'socket.io': () => ({ on() {}, emit() {} }),
    path, config: {}, './requestPolicy': { isLocalRequest },
    './controllers/RobotController': FakeRobot,
    './controllers/MotionPlanner': class {},
    './controllers/SafetyMonitor': SafetyMonitor,
    './controllers/HandwritingEngine': class {}
  });
  const instance = new Server();
  const started = instance.start(3000);
  assert.strictEqual(listenArgs, undefined);
  await started;
  assert.strictEqual(initialized, true);
  assert.strictEqual(listenArgs[1], '127.0.0.1');
  let response;
  routes['/api/status']({}, { json(value) { response = value; } });
  assert.strictEqual(response.simulationMode, true);
  assert.strictEqual(response.hardwareMotionEnabled, false);
  assert.strictEqual(response.safetyActive, true);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS ${name}`);
  }
  console.log(`${tests.length} offline tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
