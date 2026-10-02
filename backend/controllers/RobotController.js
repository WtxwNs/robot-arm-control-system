/**
 * 机器人控制器 - EtherCAT 通信与运动控制
 * 
 * 该类负责与埃斯顿协作机器人进行底层通信，包括：
 * - EtherCAT 总线通信
 * - 关节空间运动控制
 * - 笛卡尔空间运动控制
 * - 实时状态反馈
 */

const EventEmitter = require('events');
const math = require('mathjs');
const winston = require('winston');

const Kinematics = require('./Kinematics');

// 配置DH参数 (埃斯顿S3-60机器人MDH参数)
const DH_PARAMS = [
  { a: 0, alpha: 0, d: 0.267, theta: 0 },     // J1
  { a: 0.290, alpha: -Math.PI/2, d: 0, theta: 0 },  // J2
  { a: 0, alpha: Math.PI/2, d: 0.342, theta: 0 },   // J3
  { a: 0, alpha: -Math.PI/2, d: 0, theta: 0 },      // J4
  { a: 0, alpha: Math.PI/2, d: 0.342, theta: 0 },   // J5
  { a: 0, alpha: -Math.PI/2, d: 0, theta: 0 }       // J6
];

// 关节限位 (弧度)
const JOINT_LIMITS = [
  { min: -2.97, max: 2.97 },  // J1: -170° to 170°
  { min: -2.27, max: 2.27 },  // J2: -130° to 130°
  { min: -2.97, max: 2.97 },  // J3: -170° to 170°
  { min: -3.05, max: 3.05 },  // J4: -175° to 175°
  { min: -2.27, max: 2.27 },  // J5: -130° to 130°
  { min: -6.28, max: 6.28 }   // J6: -360° to 360°
];

class RobotController extends EventEmitter {
  constructor() {
    super();
    
    this.kinematics = new Kinematics(DH_PARAMS);
    this.ethercatMaster = null;
    this.connected = false;
    this.isMoving = false;
    this.emergencyStopped = false;
    
    // 当前关节角度 (弧度)
    this.currentJoints = [0, 0, 0, 0, 0, 0];
    
    // 目标关节角度 (弧度)
    this.targetJoints = [0, 0, 0, 0, 0, 0];
    
    // 末端执行器位姿
    this.endEffectorPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    
    // 通信周期 (ms)
    this.cycleTime = 10;
    
    // 日志记录
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.simple(),
      transports: [
        new winston.transports.File({ filename: 'logs/robot-controller.log' })
      ]
    });
  }

  /**
   * 初始化机器人控制器
   */
  async initialize() {
    try {
      this.logger.info('Initializing robot controller...');
      
      // 初始化EtherCAT主站
      await this.initEtherCAT();
      
      // 启动周期性控制循环
      this.startControlLoop();
      
      // 启动状态监控
      this.startStatusMonitoring();
      
      this.logger.info('Robot controller initialized successfully');
      return true;
    } catch (error) {
      this.logger.error(`Failed to initialize robot controller: ${error.message}`);
      throw error;
    }
  }

  /**
   * 初始化EtherCAT通信
   */
  async initEtherCAT() {
    // Physical operation is not yet validated; initialization must remain offline.
    this.connected = true;
    this.simulationMode = true;
    this.logger.info('Simulation mode enabled; hardware motion is disabled');
    return;
  }

  async initHardwareEtherCAT() {
    throw new Error('Hardware initialization is disabled pending validated safety integration');
  }

  /**
   * 配置PDO映射
   */
  async configurePDOMapping() {
    // RxPDO (主站到从站) - 控制指令
    const rxPDO = [
      { index: 0x6040, subIndex: 0x00, size: 16 },  // 控制字
      { index: 0x607A, subIndex: 0x00, size: 32 },  // 目标位置
      { index: 0x60FF, subIndex: 0x00, size: 32 },  // 目标速度
      { index: 0x6081, subIndex: 0x00, size: 32 }   // 目标加速度
    ];

    // TxPDO (从站到主站) - 状态反馈
    const txPDO = [
      { index: 0x6041, subIndex: 0x00, size: 16 },  // 状态字
      { index: 0x6064, subIndex: 0x00, size: 32 },  // 实际位置
      { index: 0x606C, subIndex: 0x00, size: 32 },  // 实际速度
      { index: 0x6077, subIndex: 0x00, size: 16 }   // 实际电流
    ];

    // 为6个关节配置PDO
    for (let i = 0; i < 6; i++) {
      await this.ethercatMaster.addPDO(i, rxPDO, txPDO);
    }
  }

  /**
   * 启动控制循环
   */
  startControlLoop() {
    this.controlTimer = setInterval(async () => {
      if (!this.connected || this.emergencyStopped) return;

      try {
        if (this.simulationMode) {
          // 模拟模式下的关节运动
          for (let i = 0; i < 6; i++) {
            const diff = this.targetJoints[i] - this.currentJoints[i];
            if (Math.abs(diff) > 0.001) {
              this.currentJoints[i] += diff * 0.1; // 平滑插值
            }
          }
        } else {
          // 实际EtherCAT通信
          await this.sendTargetPositions();
          await this.readActualPositions();
        }

        // 更新正运动学
        this.updateForwardKinematics();
        
      } catch (error) {
        this.logger.error(`Control loop error: ${error.message}`);
        this.emergencyStop();
      }
    }, this.cycleTime);
  }

  /**
   * 启动状态监控
   */
  startStatusMonitoring() {
    this.monitorTimer = setInterval(() => {
      this.emit('status-update', {
        joints: this.currentJoints,
        endEffector: this.endEffectorPose,
        isMoving: this.isMoving,
        timestamp: Date.now()
      });
    }, 100); // 10Hz 状态广播
  }

  /**
   * 发送目标位置到伺服驱动器
   */
  async sendTargetPositions() {
    if (!this.ethercatMaster) return;

    for (let i = 0; i < 6; i++) {
      const targetPosition = this.jointToEncoder(this.targetJoints[i], i);
      await this.ethercatMaster.writeSDO(i, 0x607A, 0x00, targetPosition, 32);
    }
  }

  /**
   * 读取实际关节位置
   */
  async readActualPositions() {
    if (!this.ethercatMaster) return;

    for (let i = 0; i < 6; i++) {
      const encoderValue = await this.ethercatMaster.readSDO(i, 0x6064, 0x00, 32);
      this.currentJoints[i] = this.encoderToJoint(encoderValue, i);
    }
  }

  /**
   * 关节角度转编码器值
   */
  jointToEncoder(jointAngle, jointIndex) {
    // 根据实际减速比和编码器分辨率转换
    const gearRatio = [160, 160, 120, 50, 50, 50][jointIndex];
    const encoderResolution = 131072; // 17位编码器
    return Math.round((jointAngle / (2 * Math.PI)) * encoderResolution * gearRatio);
  }

  /**
   * 编码器值转关节角度
   */
  encoderToJoint(encoderValue, jointIndex) {
    const gearRatio = [160, 160, 120, 50, 50, 50][jointIndex];
    const encoderResolution = 131072;
    return (encoderValue / (encoderResolution * gearRatio)) * (2 * Math.PI);
  }

  /**
   * 更新正运动学
   */
  updateForwardKinematics() {
    const pose = this.kinematics.forwardKinematics(this.currentJoints);
    this.endEffectorPose = {
      x: pose.position.x,
      y: pose.position.y,
      z: pose.position.z,
      rx: pose.orientation.rx,
      ry: pose.orientation.ry,
      rz: pose.orientation.rz
    };
  }

  /**
   * 关节空间运动
   */
  async moveJoint(jointIndex, targetAngle, speed = 50) {
    this.assertMotionAllowed(speed);
    // 检查关节限位
    if (!this.checkJointLimits(jointIndex, targetAngle)) {
      throw new Error(`Joint ${jointIndex + 1} target angle ${targetAngle} exceeds limits`);
    }

    this.targetJoints[jointIndex] = targetAngle;
    this.isMoving = true;

    // 等待运动完成
    await this.waitForMovementComplete();
    
    this.isMoving = false;
  }

  /**
   * 多关节同步运动
   */
  async moveJoints(targetJoints, speed = 50) {
    this.assertMotionAllowed(speed);
    if (!Array.isArray(targetJoints) || targetJoints.length !== 6) {
      throw new Error('Exactly six finite joint angles are required');
    }
    // 检查所有关节限位
    for (let i = 0; i < 6; i++) {
      if (!this.checkJointLimits(i, targetJoints[i])) {
        throw new Error(`Joint ${i + 1} target angle ${targetJoints[i]} exceeds limits`);
      }
    }

    this.targetJoints = [...targetJoints];
    this.isMoving = true;

    await this.waitForMovementComplete();
    
    this.isMoving = false;
  }

  /**
   * 笛卡尔空间运动
   */
  async moveToCartesian(x, y, z, rx = 0, ry = 0, rz = 0, speed = 50) {
    this.assertMotionAllowed(speed);
    if (![x, y, z, rx, ry, rz].every(Number.isFinite)) {
      throw new Error('Cartesian coordinates must be finite numbers');
    }
    const targetPose = { position: { x, y, z }, orientation: { rx, ry, rz } };
    
    // 逆运动学求解
    const solutions = this.kinematics.inverseKinematics(targetPose);
    
    if (solutions.length === 0) {
      throw new Error('No inverse kinematics solution found');
    }

    // 选择最优解 (最接近当前关节状态的解)
    const optimalSolution = this.selectOptimalSolution(solutions);
    
    await this.moveJoints(optimalSolution, speed);
  }

  /**
   * 检查关节限位
   */
  checkJointLimits(jointIndex, angle) {
    if (!Number.isInteger(jointIndex) || jointIndex < 0 || jointIndex >= 6 || !Number.isFinite(angle)) return false;
    const limits = JOINT_LIMITS[jointIndex];
    return angle >= limits.min && angle <= limits.max;
  }

  /**
   * 选择最优逆解
   */
  selectOptimalSolution(solutions) {
    let bestSolution = null;
    let minDistance = Infinity;

    for (const solution of solutions) {
      let distance = 0;
      for (let i = 0; i < 6; i++) {
        distance += Math.pow(solution[i] - this.currentJoints[i], 2);
      }
      
      if (distance < minDistance) {
        minDistance = distance;
        bestSolution = solution;
      }
    }

    return bestSolution;
  }

  /**
   * 等待运动完成
   */
  assertMotionAllowed(speed) {
    if (!this.connected) throw new Error('Robot is not connected');
    if (this.emergencyStopped) throw new Error('Emergency stop is latched; inspect the system before restarting');
    if (!this.simulationMode) {
      throw new Error('Hardware motion is disabled until verified safety feedback and speed control are implemented. Use simulation for offline development.');
    }
    if (this.isMoving) throw new Error('A motion is already in progress');
    if (!Number.isFinite(speed) || speed <= 0 || speed > 100) throw new Error('Speed must be a finite number in (0, 100]');
  }

  async waitForMovementComplete(timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (this.emergencyStopped) throw new Error('Movement interrupted by emergency stop');
      let allStopped = true;
      
      for (let i = 0; i < 6; i++) {
        const diff = Math.abs(this.targetJoints[i] - this.currentJoints[i]);
        if (diff > 0.001) {
          allStopped = false;
          break;
        }
      }
      
      if (allStopped) return;
      
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.emergencyStop();
    throw new Error('Movement timed out');
  }

  /**
   * 紧急停止
   */
  emergencyStop() {
    this.emergencyStopped = true;
    this.targetJoints = [...this.currentJoints];
    this.isMoving = false;
    
    if (!this.simulationMode && this.ethercatMaster) {
      // 发送停止指令到所有关节
      for (let i = 0; i < 6; i++) {
        Promise.resolve().then(() => this.ethercatMaster.writeSDO(i, 0x6040, 0x00, 0x010F, 16))
          .catch(error => this.logger.error(`Emergency stop command failed: ${error.message}`));
      }
    }
    
    this.logger.warn('Emergency stop executed');
  }

  /**
   * 获取当前关节角度
   */
  getCurrentJoints() {
    return [...this.currentJoints];
  }

  /**
   * 获取末端执行器位姿
   */
  getEndEffectorPose() {
    return { ...this.endEffectorPose };
  }

  /**
   * 是否已连接
   */
  isConnected() {
    return this.connected;
  }

  /**
   * 关闭连接
   */
  async close() {
    if (this.controlTimer) {
      clearInterval(this.controlTimer);
    }
    
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
    }
    
    if (this.ethercatMaster) {
      await this.ethercatMaster.stop();
    }
    
    this.connected = false;
    this.logger.info('Robot controller closed');
  }
}

module.exports = RobotController;