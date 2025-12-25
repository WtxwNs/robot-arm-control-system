/**
 * 安全监控模块
 * 
 * 功能：
 * - 关节限位检查
 * - 速度/加速度监控
 * - 碰撞检测
 * - 急停处理
 * - 安全状态监控
 */

const EventEmitter = require('events');
const winston = require('winston');

class SafetyMonitor extends EventEmitter {
  constructor(robotController) {
    super();
    
    this.robotController = robotController;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.simple(),
      transports: [
        new winston.transports.File({ filename: 'logs/safety.log' })
      ]
    });

    // 关节限位 (弧度)
    this.jointLimits = [
      { min: -2.97, max: 2.97, margin: 0.05 },  // J1
      { min: -2.27, max: 2.27, margin: 0.05 },  // J2
      { min: -2.97, max: 2.97, margin: 0.05 },  // J3
      { min: -3.05, max: 3.05, margin: 0.05 },  // J4
      { min: -2.27, max: 2.27, margin: 0.05 },  // J5
      { min: -6.28, max: 6.28, margin: 0.05 }   // J6
    ];

    // 速度限制 (rad/s)
    this.velocityLimits = [2.0, 2.0, 2.0, 4.0, 4.0, 6.0];
    
    // 加速度限制 (rad/s²)
    this.accelerationLimits = [8.0, 8.0, 8.0, 16.0, 16.0, 24.0];

    // 工作空间限制 (mm)
    this.workspaceLimits = {
      x: { min: -400, max: 400 },
      y: { min: -400, max: 400 },
      z: { min: 0, max: 600 }
    };

    // 碰撞检测参数
    this.collisionThreshold = 15.0; // 电流阈值 (A)
    this.collisionSensitivity = 0.8;

    // 安全状态
    this.safetyStatus = {
      isActive: true,
      emergencyStopped: false,
      limitViolations: [],
      collisionDetected: false,
      lastCheckTime: Date.now()
    };

    // 启动安全监控
    this.startMonitoring();
  }

  /**
   * 启动安全监控循环
   */
  startMonitoring() {
    this.monitorInterval = setInterval(() => {
      this.performSafetyCheck();
    }, 50); // 20Hz 安全检查

    this.logger.info('Safety monitoring started');
  }

  /**
   * 执行安全检查
   */
  performSafetyCheck() {
    if (!this.safetyStatus.isActive) return;

    try {
      const currentJoints = this.robotController.getCurrentJoints();
      const endEffectorPose = this.robotController.getEndEffectorPose();

      // 检查关节限位
      this.checkJointLimits(currentJoints);

      // 检查工作空间
      this.checkWorkspaceLimits(endEffectorPose);

      // 检查碰撞
      this.checkCollision();

      // 更新状态
      this.safetyStatus.lastCheckTime = Date.now();

    } catch (error) {
      this.logger.error(`Safety check error: ${error.message}`);
      this.triggerEmergencyStop('Safety check error');
    }
  }

  /**
   * 检查关节限位
   */
  checkJointLimits(joints) {
    const violations = [];

    for (let i = 0; i < 6; i++) {
      const joint = joints[i];
      const limit = this.jointLimits[i];
      const safeMin = limit.min + limit.margin;
      const safeMax = limit.max - limit.margin;

      if (joint < safeMin || joint > safeMax) {
        violations.push({
          joint: i + 1,
          value: joint,
          limit: joint < safeMin ? 'min' : 'max',
          safeValue: joint < safeMin ? safeMin : safeMax
        });
      }
    }

    if (violations.length > 0) {
      this.safetyStatus.limitViolations = violations;
      this.logger.warn(`Joint limit violations: ${JSON.stringify(violations)}`);
      
      // 触发保护性停止
      this.triggerProtectiveStop('Joint limit violation');
      
      // 发出警告
      this.emit('warning', {
        type: 'joint-limit',
        violations: violations
      });
    }

    return violations.length === 0;
  }

  /**
   * 检查工作空间限位
   */
  checkWorkspaceLimits(pose) {
    const { x, y, z } = pose;
    const violations = [];

    if (x < this.workspaceLimits.x.min || x > this.workspaceLimits.x.max) {
      violations.push({ axis: 'x', value: x, limit: x < this.workspaceLimits.x.min ? 'min' : 'max' });
    }
    if (y < this.workspaceLimits.y.min || y > this.workspaceLimits.y.max) {
      violations.push({ axis: 'y', value: y, limit: y < this.workspaceLimits.y.min ? 'min' : 'max' });
    }
    if (z < this.workspaceLimits.z.min || z > this.workspaceLimits.z.max) {
      violations.push({ axis: 'z', value: z, limit: z < this.workspaceLimits.z.min ? 'min' : 'max' });
    }

    if (violations.length > 0) {
      this.logger.warn(`Workspace limit violations: ${JSON.stringify(violations)}`);
      this.triggerProtectiveStop('Workspace limit violation');
      
      this.emit('warning', {
        type: 'workspace-limit',
        violations: violations
      });
    }

    return violations.length === 0;
  }

  /**
   * 检查速度限制
   */
  checkVelocityLimits(velocities) {
    const violations = [];

    for (let i = 0; i < 6; i++) {
      if (Math.abs(velocities[i]) > this.velocityLimits[i]) {
        violations.push({
          joint: i + 1,
          velocity: velocities[i],
          limit: this.velocityLimits[i]
        });
      }
    }

    if (violations.length > 0) {
      this.logger.warn(`Velocity limit violations: ${JSON.stringify(violations)}`);
      this.triggerProtectiveStop('Velocity limit violation');
    }

    return violations.length === 0;
  }

  /**
   * 检查碰撞
   */
  checkCollision() {
    // 在实际系统中，这里会读取电机电流或力矩传感器
    // 模拟碰撞检测
    const collisionProbability = Math.random() * 0.001; // 0.1% 概率
    
    if (collisionProbability > 0.0005) {
      this.safetyStatus.collisionDetected = true;
      this.logger.warn('Collision detected!');
      
      this.triggerEmergencyStop('Collision detected');
      
      this.emit('collision', {
        timestamp: Date.now(),
        severity: 'high'
      });
      
      return true;
    }

    return false;
  }

  /**
   * 触发保护性停止
   */
  triggerProtectiveStop(reason) {
    this.logger.warn(`Protective stop triggered: ${reason}`);
    
    // 平滑停止
    this.robotController.targetJoints = [...this.robotController.currentJoints];
    
    this.emit('protective-stop', {
      reason: reason,
      timestamp: Date.now()
    });
  }

  /**
   * 触发紧急停止
   */
  triggerEmergencyStop(reason) {
    this.safetyStatus.emergencyStopped = true;
    this.logger.error(`Emergency stop triggered: ${reason}`);
    
    // 立即执行紧急停止
    this.robotController.emergencyStop();
    
    this.emit('emergency-stop', {
      reason: reason,
      timestamp: Date.now()
    });
  }

  /**
   * 重置安全状态
   */
  reset() {
    this.safetyStatus.emergencyStopped = false;
    this.safetyStatus.limitViolations = [];
    this.safetyStatus.collisionDetected = false;
    
    this.logger.info('Safety system reset');
    this.emit('reset');
  }

  /**
   * 启用/禁用安全监控
   */
  setActive(active) {
    this.safetyStatus.isActive = active;
    this.logger.info(`Safety monitoring ${active ? 'enabled' : 'disabled'}`);
  }

  /**
   * 获取安全状态
   */
  getStatus() {
    return {
      ...this.safetyStatus,
      robotConnected: this.robotController.isConnected(),
      currentJoints: this.robotController.getCurrentJoints(),
      endEffectorPose: this.robotController.getEndEffectorPose()
    };
  }

  /**
   * 检查目标位置是否安全
   */
  isTargetSafe(targetJoints) {
    // 检查关节限位
    for (let i = 0; i < 6; i++) {
      const limit = this.jointLimits[i];
      if (targetJoints[i] < limit.min || targetJoints[i] > limit.max) {
        return false;
      }
    }
    
    // 检查奇异点
    return !this.isNearSingularity(targetJoints);
  }

  /**
   * 检查是否接近奇异点
   */
  isNearSingularity(joints) {
    // 检查J5接近±90° (腕部奇异)
    if (Math.abs(Math.abs(joints[4]) - Math.PI/2) < 0.1) {
      return true;
    }
    
    // 检查肩部奇异
    const r = Math.sqrt(
      Math.pow(joints[0], 2) + 
      Math.pow(joints[1], 2)
    );
    if (r < 0.1) {
      return true;
    }
    
    return false;
  }

  /**
   * 计算安全速度
   */
  calculateSafeSpeed(targetJoints, currentJoints, desiredSpeed) {
    let maxSpeedRatio = 1.0;
    
    // 根据与限位的距离调整速度
    for (let i = 0; i < 6; i++) {
      const limit = this.jointLimits[i];
      const distanceToMin = Math.abs(targetJoints[i] - limit.min);
      const distanceToMax = Math.abs(targetJoints[i] - limit.max);
      const minDistance = Math.min(distanceToMin, distanceToMax);
      
      if (minDistance < 0.5) { // 距离限位小于0.5弧度
        maxSpeedRatio = Math.min(maxSpeedRatio, minDistance / 0.5);
      }
    }
    
    return desiredSpeed * maxSpeedRatio;
  }

  /**
   * 执行安全自检
   */
  performSelfCheck() {
    const results = {
      timestamp: Date.now(),
      checks: {}
    };

    // 检查关节限位传感器
    results.checks.jointLimits = this.checkJointLimits(this.robotController.getCurrentJoints());
    
    // 检查通信状态
    results.checks.communication = this.robotController.isConnected();
    
    // 检查急停按钮
    results.checks.emergencyStop = !this.safetyStatus.emergencyStopped;
    
    // 检查工作空间
    results.checks.workspace = this.checkWorkspaceLimits(this.robotController.getEndEffectorPose());

    // 总体状态
    results.overall = Object.values(results.checks).every(check => check === true);

    this.logger.info(`Self-check results: ${JSON.stringify(results)}`);
    return results;
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    this.logger.info('Safety monitoring stopped');
  }
}

module.exports = SafetyMonitor;