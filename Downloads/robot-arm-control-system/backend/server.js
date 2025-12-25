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
const cors = require('cors');
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
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.initializeControllers();
    this.setupSocketHandlers();
    this.setupSafetySystems();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../frontend')));
  }

  setupRoutes() {
    // API 路由
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        robotConnected: this.robotController?.isConnected() || false,
        safetyActive: this.safetyMonitor?.isActive() || false
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

      logger.info('All controllers initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize controllers: ${error.message}`);
    }
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // 发送初始状态
      socket.emit('system-status', {
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
          const trajectory = this.handwritingEngine.generateTrajectory(text, fontSize);
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
    setInterval(() => {
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

    // 安全监控循环
    setInterval(() => {
      if (this.safetyMonitor) {
        this.safetyMonitor.checkLimits();
      }
    }, 50); // 20Hz 安全检查
  }

  handleEmergencyStop() {
    logger.warn('Emergency stop activated!');
    if (this.robotController) {
      this.robotController.emergencyStop();
    }
    this.io.emit('emergency-stop-activated');
  }

  start(port = 3000) {
    this.server.listen(port, () => {
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
  server.start(process.env.PORT || 3000);
}

module.exports = RobotControlServer;