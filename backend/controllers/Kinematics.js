/**
 * 机器人运动学核心算法模块
 * 
 * 实现六自由度串联机械臂的正向运动学、逆向运动学、雅可比矩阵计算
 * 基于改进型DH参数法 (Modified DH Convention)
 */

const math = require('mathjs');

class Kinematics {
  constructor(dhParams) {
    this.dhParams = dhParams;
    this.epsilon = 1e-6; // 数值计算精度
    this.maxIterations = 100; // 逆解最大迭代次数
  }

  /**
   * 构建DH变换矩阵
   * @param {number} a - 连杆长度
   * @param {number} alpha - 连杆扭角 (rad)
   * @param {number} d - 连杆偏距
   * @param {number} theta - 关节角 (rad)
   * @returns {math.Matrix} 4x4齐次变换矩阵
   */
  buildDHMatrix(a, alpha, d, theta) {
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);

    return math.matrix([
      [ct, -st, 0, a],
      [st * ca, ct * ca, -sa, -d * sa],
      [st * sa, ct * sa, ca, d * ca],
      [0, 0, 0, 1]
    ]);
  }

  /**
   * 正向运动学计算
   * @param {number[]} joints - 6个关节角度 (rad)
   * @returns {Object} 末端执行器位姿 {position, orientation}
   */
  forwardKinematics(joints) {
    let T = math.identity(4);
    
    // 计算各连杆变换矩阵并连乘
    for (let i = 0; i < 6; i++) {
      const { a, alpha, d, theta } = this.dhParams[i];
      const Ti = this.buildDHMatrix(a, alpha, d, theta + joints[i]);
      T = math.multiply(T, Ti);
    }

    // 提取位置和姿态
    const position = {
      x: T.get([0, 3]),
      y: T.get([1, 3]),
      z: T.get([2, 3])
    };

    // 从旋转矩阵提取欧拉角 (XYZ顺序)
    const orientation = this.extractEulerAngles(T);

    return { position, orientation };
  }

  /**
   * 从旋转矩阵提取欧拉角
   */
  extractEulerAngles(transformMatrix) {
    const R = transformMatrix.subset(math.index([0, 1, 2], [0, 1, 2]));
    
    const r11 = R.get([0, 0]);
    const r12 = R.get([0, 1]);
    const r13 = R.get([0, 2]);
    const r21 = R.get([1, 0]);
    const r22 = R.get([1, 1]);
    const r23 = R.get([1, 2]);
    const r31 = R.get([2, 0]);
    const r32 = R.get([2, 1]);
    const r33 = R.get([2, 2]);

    let rx, ry, rz;

    if (Math.abs(r31) < 0.99999) {
      ry = -Math.asin(r31);
      const cry = Math.cos(ry);
      rx = Math.atan2(r32 / cry, r33 / cry);
      rz = Math.atan2(r21 / cry, r11 / cry);
    } else {
      // 万向节锁
      rx = 0;
      if (r31 < 0) {
        ry = Math.PI / 2;
        rz = Math.atan2(r12, r13);
      } else {
        ry = -Math.PI / 2;
        rz = Math.atan2(-r12, -r13);
      }
    }

    return { rx, ry, rz };
  }

  /**
   * 逆向运动学求解 (解析法 + 数值迭代)
   * @param {Object} targetPose - 目标位姿 {position: {x, y, z}, orientation: {rx, ry, rz}}
   * @returns {number[][]} 所有可行解的数组
   */
  inverseKinematics(targetPose) {
    const solutions = [];
    
    try {
      // 1. 计算目标变换矩阵
      const targetMatrix = this.poseToMatrix(targetPose);
      
      // 2. 提取腕部中心点位置
      const wristCenter = this.calculateWristCenter(targetMatrix);
      
      // 3. 求解前三个关节 (位置级)
      const baseSolutions = this.solveFirstThreeJoints(wristCenter);
      
      // 4. 对每个前三个关节的解，求解后三个关节 (姿态级)
      for (const baseSolution of baseSolutions) {
        const wristSolutions = this.solveLastThreeJoints(baseSolution, targetMatrix);
        solutions.push(...wristSolutions);
      }
      
      // 5. 过滤无效解
      const validSolutions = this.filterValidSolutions(solutions);
      
      return validSolutions;
      
    } catch (error) {
      console.error('Inverse kinematics error:', error);
      return [];
    }
  }

  /**
   * 位姿转变换矩阵
   */
  poseToMatrix(pose) {
    const { x, y, z } = pose.position;
    const { rx, ry, rz } = pose.orientation;

    // 构建旋转矩阵 (XYZ欧拉角)
    const Rx = math.matrix([
      [1, 0, 0],
      [0, Math.cos(rx), -Math.sin(rx)],
      [0, Math.sin(rx), Math.cos(rx)]
    ]);

    const Ry = math.matrix([
      [Math.cos(ry), 0, Math.sin(ry)],
      [0, 1, 0],
      [-Math.sin(ry), 0, Math.cos(ry)]
    ]);

    const Rz = math.matrix([
      [Math.cos(rz), -Math.sin(rz), 0],
      [Math.sin(rz), Math.cos(rz), 0],
      [0, 0, 1]
    ]);

    const R = math.multiply(math.multiply(Rz, Ry), Rx);
    
    // 构建齐次变换矩阵
    const T = math.identity(4);
    T.subset(math.index([0, 1, 2], [0, 1, 2]), R);
    T.set([0, 3], x);
    T.set([1, 3], y);
    T.set([2, 3], z);

    return T;
  }

  /**
   * 计算腕部中心点位置
   */
  calculateWristCenter(targetMatrix) {
    // 提取Z轴方向向量
    const zVector = math.matrix([
      [targetMatrix.get([0, 2])],
      [targetMatrix.get([1, 2])],
      [targetMatrix.get([2, 2])]
    ]);

    // 腕部中心 = 末端位置 - d6 * Z轴方向
    const d6 = this.dhParams[5].d;
    const wristCenter = math.subtract(
      math.matrix([[targetMatrix.get([0, 3])], [targetMatrix.get([1, 3])], [targetMatrix.get([2, 3])]]),
      math.multiply(zVector, d6)
    );

    return {
      x: wristCenter.get([0, 0]),
      y: wristCenter.get([1, 0]),
      z: wristCenter.get([2, 0])
    };
  }

  /**
   * 求解前三个关节角度
   */
  solveFirstThreeJoints(wristCenter) {
    const solutions = [];
    const { x, y, z } = wristCenter;
    
    // J1: 基座旋转
    const theta1_base = Math.atan2(y, x);
    
    // J1有两个可能的解 (左臂/右臂配置)
    const theta1_candidates = [theta1_base, theta1_base + Math.PI];
    
    for (const theta1 of theta1_candidates) {
      // 计算J2和J3
      const r = Math.sqrt(x*x + y*y);
      const z_rel = z - this.dhParams[0].d;
      
      const a2 = this.dhParams[1].a;
      const a3 = 0; // 假设
      const d4 = this.dhParams[2].d;
      
      const D = (r*r + z_rel*z_rel - a2*a2 - d4*d4) / (2*a2*d4);
      
      if (Math.abs(D) > 1) continue; // 无解
      
      const theta3_offset = Math.atan2(Math.sqrt(1 - D*D), D);
      const theta3_candidates = [theta3_offset, -theta3_offset];
      
      for (const theta3 of theta3_candidates) {
        // 计算J2
        const k1 = a2 + d4 * Math.cos(theta3);
        const k2 = d4 * Math.sin(theta3);
        
        const theta2_base = Math.atan2(z_rel, r);
        const theta2_offset = Math.atan2(k2, k1);
        const theta2 = theta2_base - theta2_offset;
        
        solutions.push([theta1, theta2, theta3, 0, 0, 0]);
      }
    }
    
    return solutions;
  }

  /**
   * 求解后三个关节角度
   */
  solveLastThreeJoints(baseSolution, targetMatrix) {
    const solutions = [];
    const [theta1, theta2, theta3] = baseSolution;
    
    // 计算前三个关节的变换矩阵
    let T03 = math.identity(4);
    for (let i = 0; i < 3; i++) {
      const { a, alpha, d, theta } = this.dhParams[i];
      const Ti = this.buildDHMatrix(a, alpha, d, theta + [theta1, theta2, theta3][i]);
      T03 = math.multiply(T03, Ti);
    }
    
    // 计算后三个关节需要实现的变换
    const T36 = math.multiply(math.inv(T03), targetMatrix);
    const R36 = T36.subset(math.index([0, 1, 2], [0, 1, 2]));
    
    // 提取欧拉角
    const { rx, ry, rz } = this.extractEulerAnglesFromRotation(R36);
    
    const theta4 = rx;
    const theta5 = ry;
    const theta6 = rz;
    
    solutions.push([theta1, theta2, theta3, theta4, theta5, theta6]);
    
    return solutions;
  }

  /**
   * 从旋转矩阵提取欧拉角
   */
  extractEulerAnglesFromRotation(R) {
    const r11 = R.get([0, 0]);
    const r12 = R.get([0, 1]);
    const r13 = R.get([0, 2]);
    const r21 = R.get([1, 0]);
    const r22 = R.get([1, 1]);
    const r23 = R.get([1, 2]);
    const r31 = R.get([2, 0]);
    const r32 = R.get([2, 1]);
    const r33 = R.get([2, 2]);

    let rx, ry, rz;

    if (Math.abs(r31) < 0.99999) {
      ry = -Math.asin(r31);
      const cry = Math.cos(ry);
      rx = Math.atan2(r32 / cry, r33 / cry);
      rz = Math.atan2(r21 / cry, r11 / cry);
    } else {
      rx = 0;
      if (r31 < 0) {
        ry = Math.PI / 2;
        rz = Math.atan2(r12, r13);
      } else {
        ry = -Math.PI / 2;
        rz = Math.atan2(-r12, -r13);
      }
    }

    return { rx, ry, rz };
  }

  /**
   * 过滤有效解
   */
  filterValidSolutions(solutions) {
    return solutions.filter(solution => {
      // 检查关节限位
      for (let i = 0; i < 6; i++) {
        if (Math.abs(solution[i]) > 3.5) { // ±200°
          return false;
        }
      }
      return true;
    });
  }

  /**
   * 计算雅可比矩阵
   */
  computeJacobian(joints) {
    const J = math.zeros(6, 6);
    const pose = this.forwardKinematics(joints);
    const endEffectorPos = math.matrix([[pose.position.x], [pose.position.y], [pose.position.z]]);

    for (let i = 0; i < 6; i++) {
      // 计算当前关节轴的方向
      let axis = math.matrix([[0], [0], [1]]); // Z轴
      
      // 计算当前关节的位置
      let jointPos = math.matrix([[0], [0], [0]]);
      
      if (i > 0) {
        const jointPose = this.forwardKinematics(joints.slice(0, i));
        jointPos = math.matrix([[jointPose.position.x], [jointPose.position.y], [jointPose.position.z]]);
        
        // 计算关节轴方向
        const jointMatrix = this.poseToMatrix(jointPose);
        axis = math.matrix([
          [jointMatrix.get([0, 2])],
          [jointMatrix.get([1, 2])],
          [jointMatrix.get([2, 2])]
        ]);
      }

      // 计算线速度分量
      const linearVelocity = math.cross(axis, math.subtract(endEffectorPos, jointPos));
      J.set([0, i], linearVelocity.get([0, 0]));
      J.set([1, i], linearVelocity.get([1, 0]));
      J.set([2, i], linearVelocity.get([2, 0]));

      // 角速度分量
      J.set([3, i], axis.get([0, 0]));
      J.set([4, i], axis.get([1, 0]));
      J.set([5, i], axis.get([2, 0]));
    }

    return J;
  }

  /**
   * 数值逆解 (用于验证解析解)
   */
  numericalInverseKinematics(targetPose, initialJoints = [0, 0, 0, 0, 0, 0]) {
    let joints = [...initialJoints];
    
    for (let iter = 0; iter < this.maxIterations; iter++) {
      const currentPose = this.forwardKinematics(joints);
      const error = this.calculatePoseError(currentPose, targetPose);
      
      if (math.norm(error) < this.epsilon) {
        return joints;
      }
      
      const J = this.computeJacobian(joints);
      const J_inv = math.pinv(J);
      const deltaJoints = math.multiply(J_inv, error);
      
      for (let i = 0; i < 6; i++) {
        joints[i] -= deltaJoints.get([i, 0]);
      }
    }
    
    return null; // 未收敛
  }

  /**
   * 计算位姿误差
   */
  calculatePoseError(currentPose, targetPose) {
    const positionError = [
      targetPose.position.x - currentPose.position.x,
      targetPose.position.y - currentPose.position.y,
      targetPose.position.z - currentPose.position.z
    ];
    
    const orientationError = [
      targetPose.orientation.rx - currentPose.orientation.rx,
      targetPose.orientation.ry - currentPose.orientation.ry,
      targetPose.orientation.rz - currentPose.orientation.rz
    ];
    
    return math.matrix([
      [positionError[0]],
      [positionError[1]],
      [positionError[2]],
      [orientationError[0]],
      [orientationError[1]],
      [orientationError[2]]
    ]);
  }
}

module.exports = Kinematics;