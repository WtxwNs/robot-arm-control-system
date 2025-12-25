/**
 * 运动规划器 - 轨迹生成与平滑算法
 * 
 * 实现功能：
 * - 五次多项式插值轨迹规划
 * - S曲线加减速规划
 * - 关节空间轨迹生成
 * - 笛卡尔空间轨迹生成
 * - 智能复位路径规划
 */

const math = require('mathjs');
const winston = require('winston');

class MotionPlanner {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.simple(),
      transports: [
        new winston.transports.File({ filename: 'logs/motion-planner.log' })
      ]
    });

    // 默认关节零位 (弧度)
    this.homePosition = [0, 0, Math.PI/2, 0, Math.PI/2, 0];
    
    // 最大速度和加速度限制
    this.maxVelocity = [2.0, 2.0, 2.0, 4.0, 4.0, 6.0]; // rad/s
    this.maxAcceleration = [8.0, 8.0, 8.0, 16.0, 16.0, 24.0]; // rad/s²
  }

  /**
   * 五次多项式插值轨迹规划
   * 
   * 边界条件：
   * q(0) = q0, q(tf) = qf
   * q'(0) = v0, q'(tf) = vf
   * q''(0) = a0, q''(tf) = af
   * 
   * @param {number} q0 - 起始位置
   * @param {number} qf - 目标位置
   * @param {number} tf - 运动时间
   * @param {number} v0 - 起始速度 (默认0)
   * @param {number} vf - 目标速度 (默认0)
   * @param {number} a0 - 起始加速度 (默认0)
   * @param {number} af - 目标加速度 (默认0)
   * @returns {Function} 轨迹函数 q(t)
   */
  quinticPolynomial(q0, qf, tf, v0 = 0, vf = 0, a0 = 0, af = 0) {
    // 求解五次多项式系数
    const M = math.matrix([
      [1, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 2, 0, 0, 0],
      [1, tf, tf*tf, tf*tf*tf, tf*tf*tf*tf, tf*tf*tf*tf*tf],
      [0, 1, 2*tf, 3*tf*tf, 4*tf*tf*tf, 5*tf*tf*tf*tf],
      [0, 0, 2, 6*tf, 12*tf*tf, 20*tf*tf*tf]
    ]);

    const b = math.matrix([[q0], [v0], [a0], [qf], [vf], [af]]);
    const coeffs = math.multiply(math.inv(M), b);

    // 返回轨迹函数
    return (t) => {
      if (t <= 0) return q0;
      if (t >= tf) return qf;
      
      let qt = 0;
      for (let i = 0; i < 6; i++) {
        qt += coeffs.get([i, 0]) * Math.pow(t, i);
      }
      return qt;
    };
  }

  /**
   * 生成关节空间轨迹
   * @param {number[]} startJoints - 起始关节角度
   * @param {number[]} endJoints - 目标关节角度
   * @param {number} duration - 运动持续时间 (秒)
   * @param {number} sampleTime - 采样时间 (秒)
 * @returns {Object[]} 轨迹点数组 [{time, position, velocity, acceleration}]
   */
  generateJointTrajectory(startJoints, endJoints, duration, sampleTime = 0.01) {
    const trajectory = [];
    const numPoints = Math.ceil(duration / sampleTime);

    // 为每个关节生成五次多项式
    const polynomials = [];
    for (let i = 0; i < 6; i++) {
      const poly = this.quinticPolynomial(
        startJoints[i], 
        endJoints[i], 
        duration,
        0, 0, 0, 0  // 零速零加速度边界条件
      );
      polynomials.push(poly);
    }

    // 生成轨迹点
    for (let i = 0; i <= numPoints; i++) {
      const t = i * sampleTime;
      const point = {
        time: t,
        position: [],
        velocity: [],
        acceleration: []
      };

      for (let j = 0; j < 6; j++) {
        point.position.push(polynomials[j](t));
        
        // 数值计算速度和加速度
        const dt = 0.001;
        const q1 = polynomials[j](t - dt);
        const q2 = polynomials[j](t + dt);
        const v = (q2 - q1) / (2 * dt);
        const a = (q2 - 2 * polynomials[j](t) + q1) / (dt * dt);
        
        point.velocity.push(v);
        point.acceleration.push(a);
      }

      trajectory.push(point);
    }

    return trajectory;
  }

  /**
   * 生成笛卡尔空间直线轨迹
   * @param {Object} startPose - 起始位姿 {position: {x, y, z}, orientation: {rx, ry, rz}}
   * @param {Object} endPose - 目标位姿
   * @param {number} duration - 运动时间
   * @param {number} sampleTime - 采样时间
   * @returns {Object[]} 轨迹点数组
   */
  generateCartesianTrajectory(startPose, endPose, duration, sampleTime = 0.01) {
    const trajectory = [];
    const numPoints = Math.ceil(duration / sampleTime);

    // 提取起始和目标位置
    const startPos = startPose.position;
    const endPos = endPose.position;
    const startRot = startPose.orientation;
    const endRot = endPose.orientation;

    for (let i = 0; i <= numPoints; i++) {
      const t = i * sampleTime;
      const s = t / duration; // 归一化时间 [0, 1]

      // 位置线性插值
      const position = {
        x: startPos.x + s * (endPos.x - startPos.x),
        y: startPos.y + s * (endPos.y - startPos.y),
        z: startPos.z + s * (endPos.z - startPos.z)
      };

      // 姿态球面线性插值 (Slerp)
      const orientation = this.slerpEuler(startRot, endRot, s);

      trajectory.push({
        time: t,
        position,
        orientation
      });
    }

    return trajectory;
  }

  /**
   * 球面线性插值 (Slerp) for Euler angles
   */
  slerpEuler(start, end, t) {
    // 将欧拉角转换为四元数
    const qStart = this.eulerToQuaternion(start);
    const qEnd = this.eulerToQuaternion(end);
    
    // 四元数Slerp
    const qResult = this.quaternionSlerp(qStart, qEnd, t);
    
    // 转回欧拉角
    return this.quaternionToEuler(qResult);
  }

  /**
   * 欧拉角转四元数
   */
  eulerToQuaternion(euler) {
    const { rx, ry, rz } = euler;
    
    const cx = Math.cos(rx / 2);
    const cy = Math.cos(ry / 2);
    const cz = Math.cos(rz / 2);
    const sx = Math.sin(rx / 2);
    const sy = Math.sin(ry / 2);
    const sz = Math.sin(rz / 2);

    return {
      w: cx * cy * cz + sx * sy * sz,
      x: sx * cy * cz - cx * sy * sz,
      y: cx * sy * cz + sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz
    };
  }

  /**
   * 四元数转欧拉角
   */
  quaternionToEuler(quat) {
    const { w, x, y, z } = quat;
    
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const rx = Math.atan2(sinr_cosp, cosr_cosp);

    const sinp = 2 * (w * y - z * x);
    const ry = Math.abs(sinp) >= 1 ? 
      Math.sign(sinp) * Math.PI / 2 : 
      Math.asin(sinp);

    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const rz = Math.atan2(siny_cosp, cosy_cosp);

    return { rx, ry, rz };
  }

  /**
   * 四元数球面线性插值
   */
  quaternionSlerp(q1, q2, t) {
    let dot = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
    
    // 确保最短路径
    if (dot < 0) {
      q2 = { w: -q2.w, x: -q2.x, y: -q2.y, z: -q2.z };
      dot = -dot;
    }

    const DOT_THRESHOLD = 0.9995;
    
    if (dot > DOT_THRESHOLD) {
      // 线性插值避免除零
      return {
        w: q1.w + t * (q2.w - q1.w),
        x: q1.x + t * (q2.x - q1.x),
        y: q1.y + t * (q2.y - q1.y),
        z: q1.z + t * (q2.z - q1.z)
      };
    }

    const theta_0 = Math.acos(dot);
    const sin_theta_0 = Math.sin(theta_0);
    const theta = theta_0 * t;
    const sin_theta = Math.sin(theta);
    const cos_theta = Math.cos(theta);
    const s0 = cos_theta - dot * sin_theta / sin_theta_0;
    const s1 = sin_theta / sin_theta_0;

    return {
      w: s0 * q1.w + s1 * q2.w,
      x: s0 * q1.x + s1 * q2.x,
      y: s0 * q1.y + s1 * q2.y,
      z: s0 * q1.z + s1 * q2.z
    };
  }

  /**
   * 执行智能复位
   */
  async executeHoming(robotController, speed = 30) {
    this.logger.info('Executing homing sequence...');
    
    const currentJoints = robotController.getCurrentJoints();
    const duration = this.calculateMovementTime(currentJoints, this.homePosition, speed);
    
    // 生成平滑轨迹
    const trajectory = this.generateJointTrajectory(
      currentJoints, 
      this.homePosition, 
      duration, 
      0.01
    );

    // 执行轨迹
    await this.executeTrajectory(robotController, trajectory, speed);
    
    this.logger.info('Homing completed');
  }

  /**
   * 计算运动时间
   */
  calculateMovementTime(startJoints, endJoints, speedPercent = 50) {
    // 计算最大关节位移
    let maxDisplacement = 0;
    for (let i = 0; i < 6; i++) {
      const displacement = Math.abs(endJoints[i] - startJoints[i]);
      maxDisplacement = Math.max(maxDisplacement, displacement);
    }

    // 根据速度百分比计算时间
    const baseTime = maxDisplacement / 1.0; // 1 rad/s 基准
    const speedFactor = speedPercent / 100;
    
    return Math.max(baseTime / speedFactor, 2.0); // 最少2秒
  }

  /**
   * 执行轨迹
   */
  async executeTrajectory(robotController, trajectory, speed = 50) {
    const sampleTime = 0.01; // 10ms
    
    for (const point of trajectory) {
      if (point.position) {
        // 关节空间轨迹
        await robotController.moveJoints(point.position, speed);
      }
      
      // 等待采样时间
      await new Promise(resolve => setTimeout(resolve, sampleTime * 1000));
    }
  }

  /**
   * S曲线加减速规划
   */
  generateSCurveTrajectory(startPos, endPos, maxVel, maxAcc, maxJerk, sampleTime = 0.01) {
    const displacement = endPos - startPos;
    const direction = Math.sign(displacement);
    const distance = Math.abs(displacement);

    // S曲线参数计算
    const ta = maxAcc / maxJerk; // 加加速时间
    const tv = maxVel / maxAcc; // 匀加速时间
    
    // 判断是否能达到最大速度
    const distanceToMaxVel = maxAcc * Math.pow(ta, 2) + maxVel * tv;
    
    let t1, t2, t3, t4, t5, t6, t7;
    
    if (distance >= distanceToMaxVel) {
      // 七段式S曲线
      t1 = ta;
      t2 = tv;
      t3 = ta;
      t4 = (distance - distanceToMaxVel) / maxVel;
      t5 = ta;
      t6 = tv;
      t7 = ta;
    } else {
      // 五段式S曲线
      const vm = Math.sqrt(maxAcc * distance);
      t1 = ta;
      t2 = vm / maxAcc - ta;
      t3 = ta;
      t4 = 0;
      t5 = ta;
      t6 = vm / maxAcc - ta;
      t7 = ta;
    }

    // 生成轨迹点
    const totalTime = t1 + t2 + t3 + t4 + t5 + t6 + t7;
    const numPoints = Math.ceil(totalTime / sampleTime);
    const trajectory = [];

    for (let i = 0; i <= numPoints; i++) {
      const t = i * sampleTime;
      let pos, vel, acc;

      if (t <= t1) {
        // 加加速段
        pos = startPos + direction * (maxJerk * Math.pow(t, 3) / 6);
        vel = direction * (maxJerk * Math.pow(t, 2) / 2);
        acc = direction * (maxJerk * t);
      } else if (t <= t1 + t2) {
        // 匀加速段
        const t_rel = t - t1;
        pos = startPos + direction * (maxJerk * Math.pow(t1, 3) / 6 + maxAcc * t1 * t_rel + maxAcc * Math.pow(t_rel, 2) / 2);
        vel = direction * (maxAcc * t1 + maxAcc * t_rel);
        acc = direction * maxAcc;
      } else if (t <= t1 + t2 + t3) {
        // 减加速段
        const t_rel = t - t1 - t2;
        pos = startPos + direction * (maxJerk * Math.pow(t1, 3) / 6 + maxAcc * t1 * t2 + maxAcc * Math.pow(t2, 2) / 2 + 
                       maxAcc * t1 * t_rel + maxAcc * t2 * t_rel - maxJerk * Math.pow(t_rel, 3) / 6);
        vel = direction * (maxAcc * t1 + maxAcc * t2 + maxAcc * t_rel - maxJerk * Math.pow(t_rel, 2) / 2);
        acc = direction * (maxAcc - maxJerk * t_rel);
      } else if (t <= t1 + t2 + t3 + t4) {
        // 匀速段
        const t_rel = t - t1 - t2 - t3;
        const pos_end_acc = startPos + direction * (maxJerk * Math.pow(t1, 3) / 6 + maxAcc * t1 * t2 + maxAcc * Math.pow(t2, 2) / 2 + 
                                   maxAcc * t1 * t3 + maxAcc * t2 * t3 - maxJerk * Math.pow(t3, 3) / 6);
        pos = pos_end_acc + direction * maxVel * t_rel;
        vel = direction * maxVel;
        acc = 0;
      } else {
        // 减速段 (对称)
        const t_dec = totalTime - t;
        if (t_dec <= t7) {
          // 加减速段
          pos = endPos - direction * (maxJerk * Math.pow(t_dec, 3) / 6);
          vel = direction * (maxJerk * Math.pow(t_dec, 2) / 2);
          acc = -direction * (maxJerk * t_dec);
        } else if (t_dec <= t7 + t6) {
          // 匀减速段
          const t_rel = t_dec - t7;
          pos = endPos - direction * (maxJerk * Math.pow(t7, 3) / 6 + maxAcc * t7 * t_rel + maxAcc * Math.pow(t_rel, 2) / 2);
          vel = direction * (maxAcc * t7 + maxAcc * t_rel);
          acc = -direction * maxAcc;
        } else {
          // 减减速段
          const t_rel = t_dec - t7 - t6;
          pos = endPos - direction * (maxJerk * Math.pow(t7, 3) / 6 + maxAcc * t7 * t6 + maxAcc * Math.pow(t6, 2) / 2 + 
                         maxAcc * t7 * t_rel + maxAcc * t6 * t_rel - maxJerk * Math.pow(t_rel, 3) / 6);
          vel = direction * (maxAcc * t7 + maxAcc * t6 + maxAcc * t_rel - maxJerk * Math.pow(t_rel, 2) / 2);
          acc = -direction * (maxAcc - maxJerk * t_rel);
        }
      }

      trajectory.push({ time: t, position: pos, velocity: vel, acceleration: acc });
    }

    return trajectory;
  }

  /**
   * 检查轨迹是否满足关节限位
   */
  checkTrajectoryLimits(trajectory, jointLimits) {
    for (const point of trajectory) {
      for (let i = 0; i < 6; i++) {
        if (point.position[i] < jointLimits[i].min || point.position[i] > jointLimits[i].max) {
          return false;
        }
      }
    }
    return true;
  }
}

module.exports = MotionPlanner;