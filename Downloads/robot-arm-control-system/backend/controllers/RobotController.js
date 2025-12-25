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
const ethercat = require('ethercat');
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
    this.isConnected = false;
    this.isMoving = false;
    
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
    try {
      // 创建EtherCAT主站
      this.ethercatMaster = new ethercat.Master();
      
      // 配置EtherCAT从站 (埃斯顿控制器)
      const slaveConfig = {
        alias: 0,
        position: 0,
        vendorId: 0x00000666,  // 埃斯顿厂商ID
        productCode: 0x00000001
      };
      
      await this.ethercatMaster.addSlave(slaveConfig);
      
      // 配置PDO映射
      await this.configurePDOMapping();
      
      // 启动EtherCAT主站
      await this.ethercatMaster.start();
      
      this.isConnected = true;
      this.logger.info('EtherCAT communication established');
      
    } catch (error) {
      // 如果EtherCAT初始化失败，使用模拟模式
      this.logger.warn(`EtherCAT init failed, running in simulation mode: ${error.message}`);
      this.isConnected = true; // 模拟模式下也标记为已连接
      this.simulationMode = true;
    }
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
      if (!this.isConnected) return;

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
  async waitForMovementComplete(timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      let allStopped = true;
      
      for (let i = 0; i < 6; i++) {
        const diff = Math.abs(this.targetJoints[i] - this.currentJoints[i]);
        if (diff > 0.001) {
          allStopped = false;
          break;
        }
      }
      
      if (allStopped) break;
      
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * 紧急停止
   */
  emergencyStop() {
    this.targetJoints = [...this.currentJoints];
    this.isMoving = false;
    
    if (!this.simulationMode && this.ethercatMaster) {
      // 发送停止指令到所有关节
      for (let i = 0; i < 6; i++) {
        this.ethercatMaster.writeSDO(i, 0x6040, 0x00, 0x010F, 16); // 快速停止
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
    return this.isConnected;
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
    
    this.isConnected = false;
    this.logger.info('Robot controller closed');
  }
}

module.exports = RobotController;