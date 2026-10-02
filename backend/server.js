/**
 * 机器人控制系统 - 后端主服务器
 * 基于 Node.js + WebSocket + EtherCAT 的开放式控制架构
 * 
 * @author SEU Future Technology College
 * @version 1.0.0
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { isLocalRequest } = require('./requestPolicy');
const path = require('path');
const winston = require('winston');
const config = require('config');

const RobotController = require('./controllers/RobotController');
const MotionPlanner = require('./controllers/MotionPlanner');
const SafetyMonitor = require('./controllers/SafetyMonitor');
const HandwritingEngine = require('./controllers/HandwritingEngine');

// 配置日志系统
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console()
  ]
});

class RobotControlServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      allowRequest: (request, callback) => callback(null, isLocalRequest(request)),
      maxHttpBufferSize: 100000
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.ready = this.initializeControllers();
    this.setupSocketHandlers();

  }

  setupMiddleware() {
    this.app.use((req, res, next) => {
      if (!isLocalRequest(req)) return res.status(403).json({ error: 'Local same-origin requests only' });
      next();
    });
    this.app.use(express.json({ limit: '100kb' }));
    this.app.use(express.static(path.join(__dirname, '../frontend')));
  }

  setupRoutes() {
    // API 路由
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        robotConnected: this.robotController?.isConnected() || false,
        safetyActive: this.safetyMonitor?.isActive() || false,
        simulationMode: this.robotController?.simulationMode === true,
        hardwareMotionEnabled: false
      });
    });

    this.app.post('/api/emergency-stop', (req, res) => {
      this.handleEmergencyStop();
      res.json({ success: true, message: 'Emergency stop activated' });
    });
  }

  async initializeControllers() {
    try {
      // 初始化机器人控制器
      this.robotController = new RobotController();
      await this.robotController.initialize();
      
      // 初始化运动规划器
      this.motionPlanner = new MotionPlanner();
      
      // 初始化安全监控
      this.safetyMonitor = new SafetyMonitor(this.robotController);
      
      // 初始化智能书写引擎
      this.handwritingEngine = new HandwritingEngine();

      this.setupSafetySystems();
      logger.info('All controllers initialized successfully (simulation only)');
    } catch (error) {
      logger.error(`Failed to initialize controllers: ${error.message}`);
      throw error;
    }
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // 发送初始状态
      socket.emit('system-status', {
        simulationMode: this.robotController?.simulationMode === true,
        hardwareMotionEnabled: false,
        robotConnected: this.robotController?.isConnected() || false,
        joints: this.robotController?.getCurrentJoints() || [0, 0, 0, 0, 0, 0],
        endEffector: this.robotController?.getEndEffectorPose() || { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
      });

      // 关节控制
      socket.on('joint-move', async (data) => {
        try {
          const { jointIndex, angle, speed = 50 } = data;
          await this.robotController.moveJoint(jointIndex, angle, speed);
          socket.emit('joint-move-success', { jointIndex, angle });
        } catch (error) {
          logger.error(`Joint move failed: ${error.message}`);
          socket.emit('error', { message: error.message });
        }
      });

      // 笛卡尔空间运动
      socket.on('cartesian-move', async (data) => {
        try {
          const { x, y, z, rx = 0, ry = 0, rz = 0, speed = 50 } = data;
          await this.robotController.moveToCartesian(x, y, z, rx, ry, rz, speed);
          socket.emit('cartesian-move-success', { x, y, z, rx, ry, rz });
        } catch (error) {
          logger.error(`Cartesian move failed: ${error.message}`);
          socket.emit('error', { message: error.message });
        }
      });

      // 一键复位
      socket.on('home-reset', async (data) => {
        try {
          const { speed = 30 } = data;
          this.robotController.assertMotionAllowed(speed);
          await this.motionPlanner.executeHoming(this.robotController, speed);
          socket.emit('home-reset-success');
        } catch (error) {
          logger.error(`Home reset failed: ${error.message}`);
          socket.emit('error', { message: error.message });
        }
      });

      // 智能书写
      socket.on('handwriting-start', async (data) => {
        try {
          const { text, fontSize = 20, speed = 20 } = data;
          this.robotController.assertMotionAllowed(speed);
          if (typeof text !== 'string' || !text.trim() || text.length > 200 ||
              !Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 100) {
            throw new Error('Handwriting requires 1-200 characters and fontSize in (0, 100]');
          }
          const trajectory = this.handwritingEngine.generateTrajectory(text, { fontSize });
          await this.motionPlanner.executeTrajectory(this.robotController, trajectory, speed);
          socket.emit('handwriting-complete');
        } catch (error) {
          logger.error(`Handwriting failed: ${error.message}`);
          socket.emit('error', { message: error.message });
        }
      });

      // 紧急停止
      socket.on('emergency-stop', () => {
        this.handleEmergencyStop();
        socket.emit('emergency-stop-activated');
      });

      // 获取机器人状态
      socket.on('get-robot-status', () => {
        const status = {
          connected: this.robotController?.isConnected() || false,
          joints: this.robotController?.getCurrentJoints() || [0, 0, 0, 0, 0, 0],
          endEffector: this.robotController?.getEndEffectorPose() || { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
          safety: this.safetyMonitor?.getStatus() || {}
        };
        socket.emit('robot-status', status);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });
  }

  setupSafetySystems() {
    // 设置周期性状态广播
    this.statusTimer = setInterval(() => {
      if (this.robotController && this.safetyMonitor) {
        const status = {
          joints: this.robotController.getCurrentJoints(),
          endEffector: this.robotController.getEndEffectorPose(),
          safety: this.safetyMonitor.getStatus(),
          timestamp: Date.now()
        };
        this.io.emit('robot-status-update', status);
      }
    }, 100); // 100Hz 更新频率

    // SafetyMonitor owns its monitoring loop; do not create a second loop.
  }

  handleEmergencyStop() {
    logger.warn('Emergency stop activated!');
    if (this.robotController) {
      this.robotController.emergencyStop();
    }
    this.io.emit('emergency-stop-activated');
  }

  async start(port = 3000) {
    await this.ready;
    this.server.listen(port, '127.0.0.1', () => {
      logger.info(`Robot Control Server running on port ${port}`);
      console.log(`🤖 Robot Control Server Started`);
      console.log(`📡 WebSocket Server: ws://localhost:${port}`);
      console.log(`🌐 Web Interface: http://localhost:${port}`);
    });
  }
}

// 启动服务器
if (require.main === module) {
  const server = new RobotControlServer();
  server.start(Number(process.env.PORT || 3000)).catch(error => {
    logger.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = RobotControlServer;