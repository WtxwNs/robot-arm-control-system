/**
 * 智能书写引擎
 * 
 * 功能：
 * - 解析Hershey矢量字库
 * - 字符到轨迹的映射
 * - 抬笔/落笔路径生成
 * - 仿射变换 (缩放、旋转、平移)
 */

const fs = require('fs');
const path = require('path');
const math = require('mathjs');
const winston = require('winston');

class HandwritingEngine {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.simple(),
      transports: [
        new winston.transports.File({ filename: 'logs/handwriting.log' })
      ]
    });

    // 字库数据 (Hershey简化版)
    this.fontData = this.initializeFontData();
    
    // 默认书写参数
    this.defaultParams = {
      fontSize: 20,        // 字号 (mm)
      penUpHeight: 10,     // 抬笔高度 (mm)
      writeDepth: 0,       // 落笔深度 (mm)
      charSpacing: 25,     // 字符间距 (mm)
      lineSpacing: 30,     // 行间距 (mm)
      writeSpeed: 20,      // 书写速度 (mm/s)
      moveSpeed: 50        // 空移速度 (mm/s)
    };
  }

  /**
   * 初始化简化版Hershey字库数据
   */
  initializeFontData() {
    return {
      'A': {
        width: 20,
        strokes: [
          [[0, 0], [10, 20]],    // 左斜线
          [[10, 20], [20, 0]],   // 右斜线
          [[5, 10], [15, 10]]    // 横线
        ]
      },
      'B': {
        width: 18,
        strokes: [
          [[0, 0], [0, 20]],     // 左边竖线
          [[0, 20], [12, 20]],   // 上横线
          [[12, 20], [12, 10]],  // 右竖线(上)
          [[12, 10], [0, 10]],   // 中横线
          [[0, 10], [12, 10]],   // 重复中横线
          [[12, 10], [12, 0]],   // 右竖线(下)
          [[12, 0], [0, 0]]      // 下横线
        ]
      },
      'C': {
        width: 18,
        strokes: [
          [[18, 2], [16, 0]],    // 右上
          [[16, 0], [4, 0]],     // 上横线
          [[4, 0], [2, 2]],      // 左上
          [[2, 2], [2, 18]],     // 左竖线
          [[2, 18], [4, 20]],    // 左下
          [[4, 20], [16, 20]],   // 下横线
          [[16, 20], [18, 18]]   // 右下
        ]
      },
      'D': {
        width: 18,
        strokes: [
          [[0, 0], [0, 20]],     // 左竖线
          [[0, 20], [14, 20]],   // 上横线
          [[14, 20], [16, 18]],  // 右上
          [[16, 18], [16, 2]],   // 右竖线
          [[16, 2], [14, 0]],    // 右下
          [[14, 0], [0, 0]]      // 下横线
        ]
      },
      'E': {
        width: 16,
        strokes: [
          [[0, 0], [0, 20]],     // 左竖线
          [[0, 20], [14, 20]],   // 上横线
          [[0, 10], [10, 10]],   // 中横线
          [[0, 0], [14, 0]]      // 下横线
        ]
      },
      'F': {
        width: 16,
        strokes: [
          [[0, 0], [0, 20]],     // 左竖线
          [[0, 20], [14, 20]],   // 上横线
          [[0, 10], [10, 10]]    // 中横线
        ]
      },
      'G': {
        width: 20,
        strokes: [
          [[18, 2], [16, 0]],    // 右上
          [[16, 0], [4, 0]],     // 上横线
          [[4, 0], [2, 2]],      // 左上
          [[2, 2], [2, 18]],     // 左竖线
          [[2, 18], [4, 20]],    // 左下
          [[4, 20], [16, 20]],   // 下横线
          [[16, 20], [18, 18]],  // 右下
          [[18, 18], [18, 10]],  // 右竖线
          [[18, 10], [12, 10]]   // 中横线
        ]
      },
      'H': {
        width: 18,
        strokes: [
          [[0, 0], [0, 20]],     // 左竖线
          [[18, 0], [18, 20]],   // 右竖线
          [[0, 10], [18, 10]]    // 中横线
        ]
      },
      'I': {
        width: 10,
        strokes: [
          [[5, 0], [5, 20]],     // 中竖线
          [[0, 20], [10, 20]],   // 上横线
          [[0, 0], [10, 0]]      // 下横线
        ]
      },
      'J': {
        width: 14,
        strokes: [
          [[0, 20], [12, 20]],   // 上横线
          [[12, 20], [12, 4]],   // 右竖线
          [[12, 4], [8, 0]],     // 右下
          [[8, 0], [4, 0]]       // 下横线
        ]
      },
      'K': {
        width: 18,
        strokes: [
          [[0, 0], [0, 20]],     // 左竖线
          [[0, 10], [18, 20]],   // 上斜线
          [[0, 10], [18, 0]]     // 下斜线
        ]
      },
      'L': {
        width: 14,
        strokes: [
          [[0, 20], [0, 0]],     // 左竖线
          [[0, 0], [14, 0]]      // 下横线
        ]
      },
      'M': {
        width: 22,
        strokes: [
          [[0, 20], [0, 0]],     // 左竖线
          [[0, 20], [11, 10]],   // 左斜线
          [[11, 10], [22, 20]],  // 右斜线
          [[22, 20], [22, 0]]    // 右竖线
        ]
      },
      'N': {
        width: 18,
        strokes: [
          [[0, 20], [0, 0]],     // 左竖线
          [[0, 20], [18, 0]],    // 斜线
          [[18, 0], [18, 20]]    // 右竖线
        ]
      },
      'O': {
        width: 20,
        strokes: [
          [[10, 0], [18, 4]],    // 右上
          [[18, 4], [18, 16]],   // 右竖线
          [[18, 16], [10, 20]],  // 右下
          [[10, 20], [2, 16]],   // 左下
          [[2, 16], [2, 4]],     // 左竖线
          [[2, 4], [10, 0]]      // 左上
        ]
      },
      'P': {
        width: 16,
        strokes: [
          [[0, 0], [0, 20]],     // 左竖线
          [[0, 20], [12, 20]],   // 上横线
          [[12, 20], [12, 10]],  // 右竖线(上)
          [[12, 10], [0, 10]]    // 中横线
        ]
      },
      'Q': {
        width: 22,
        strokes: [
          [[10, 0], [18, 4]],    // 右上
          [[18, 4], [18, 16]],   // 右竖线
          [[18, 16], [10, 20]],  // 右下
          [[10, 20], [2, 16]],   // 左下
          [[2, 16], [2, 4]],     // 左竖线
          [[2, 4], [10, 0]],     // 左上
          [[10, 10], [22, 0]]    // 尾部斜线
        ]
      },
      'R': {
        width: 18,
        strokes: [
          [[0, 0], [0, 20]],     // 左竖线
          [[0, 20], [14, 20]],   // 上横线
          [[14, 20], [14, 10]],  // 右竖线(上)
          [[14, 10], [0, 10]],   // 中横线
          [[0, 10], [14, 0]]     // 斜线
        ]
      },
      'S': {
        width: 16,
        strokes: [
          [[14, 2], [12, 0]],    // 右上
          [[12, 0], [4, 0]],     // 上横线
          [[4, 0], [2, 4]],      // 左上
          [[2, 4], [2, 8]],      // 左竖线(上)
          [[2, 8], [14, 12]],    // 中横线
          [[14, 12], [14, 16]],  // 右竖线(下)
          [[14, 16], [12, 20]],  // 右下
          [[12, 20], [4, 20]],   // 下横线
          [[4, 20], [2, 18]]     // 左下
        ]
      },
      'T': {
        width: 18,
        strokes: [
          [[0, 20], [18, 20]],   // 上横线
          [[9, 20], [9, 0]]      // 中竖线
        ]
      },
      'U': {
        width: 18,
        strokes: [
          [[0, 20], [0, 4]],     // 左竖线
          [[0, 4], [4, 0]],      // 左上
          [[4, 0], [14, 0]],     // 下横线
          [[14, 0], [18, 4]],    // 右上
          [[18, 4], [18, 20]]    // 右竖线
        ]
      },
      'V': {
        width: 20,
        strokes: [
          [[0, 20], [10, 0]],    // 左斜线
          [[10, 0], [20, 20]]    // 右斜线
        ]
      },
      'W': {
        width: 24,
        strokes: [
          [[0, 20], [6, 0]],     // 左斜线
          [[6, 0], [12, 10]],    // 中斜线
          [[12, 10], [18, 0]],   // 中斜线
          [[18, 0], [24, 20]]    // 右斜线
        ]
      },
      'X': {
        width: 20,
        strokes: [
          [[0, 20], [20, 0]],    // 左斜线
          [[0, 0], [20, 20]]     // 右斜线
        ]
      },
      'Y': {
        width: 18,
        strokes: [
          [[0, 20], [9, 10]],    // 左斜线
          [[18, 20], [9, 10]],   // 右斜线
          [[9, 10], [9, 0]]      // 中竖线
        ]
      },
      'Z': {
        width: 18,
        strokes: [
          [[0, 20], [18, 20]],   // 上横线
          [[18, 20], [0, 0]],    // 斜线
          [[0, 0], [18, 0]]      // 下横线
        ]
      },
      '0': {
        width: 16,
        strokes: [
          [[8, 0], [14, 2]],     // 右上
          [[14, 2], [14, 18]],   // 右竖线
          [[14, 18], [8, 20]],   // 右下
          [[8, 20], [2, 18]],    // 左下
          [[2, 18], [2, 2]],     // 左竖线
          [[2, 2], [8, 0]]       // 左上
        ]
      },
      '1': {
        width: 10,
        strokes: [
          [[5, 0], [5, 20]]      // 竖线
        ]
      },
      '2': {
        width: 16,
        strokes: [
          [[0, 2], [2, 0]],      // 左上
          [[2, 0], [14, 0]],     // 上横线
          [[14, 0], [16, 4]],    // 右上
          [[16, 4], [8, 20]],    // 斜线
          [[8, 20], [0, 20]]     // 下横线
        ]
      },
      '3': {
        width: 16,
        strokes: [
          [[2, 0], [14, 0]],     // 上横线
          [[14, 0], [14, 8]],    // 右竖线(上)
          [[14, 8], [8, 12]],    // 中斜线
          [[8, 12], [14, 16]],   // 中斜线
          [[14, 16], [14, 20]],  // 右竖线(下)
          [[14, 20], [2, 20]]    // 下横线
        ]
      },
      '4': {
        width: 16,
        strokes: [
          [[0, 6], [12, 6]],     // 中横线
          [[12, 6], [12, 0]],    // 右竖线
          [[0, 20], [0, 6]],     // 左竖线
          [[0, 6], [12, 6]]      // 重复中横线
        ]
      },
      '5': {
        width: 16,
        strokes: [
          [[14, 0], [2, 0]],     // 上横线
          [[2, 0], [2, 10]],     // 左竖线
          [[2, 10], [14, 10]],   // 中横线
          [[14, 10], [14, 20]],  // 右竖线
          [[14, 20], [2, 20]]    // 下横线
        ]
      },
      '6': {
        width: 16,
        strokes: [
          [[14, 2], [12, 0]],    // 右上
          [[12, 0], [4, 0]],     // 上横线
          [[4, 0], [2, 4]],      // 左上
          [[2, 4], [2, 16]],     // 左竖线
          [[2, 16], [4, 20]],    // 左下
          [[4, 20], [12, 20]],   // 下横线
          [[12, 20], [14, 16]],  // 右下
          [[14, 16], [14, 10]],  // 右竖线
          [[14, 10], [8, 10]]    // 中横线
        ]
      },
      '7': {
        width: 16,
        strokes: [
          [[0, 20], [16, 20]],   // 上横线
          [[16, 20], [4, 0]]     // 斜线
        ]
      },
      '8': {
        width: 16,
        strokes: [
          [[8, 0], [14, 4]],     // 右上
          [[14, 4], [14, 8]],    // 右竖线(上)
          [[14, 8], [8, 12]],    // 右下
          [[8, 12], [2, 8]],     // 左下
          [[2, 8], [2, 4]],      // 左竖线(上)
          [[2, 4], [8, 0]],      // 左上
          [[2, 8], [14, 8]],     // 中横线
          [[8, 12], [14, 16]],   // 右上(下)
          [[14, 16], [14, 20]],  // 右竖线(下)
          [[14, 20], [8, 24]],   // 右下
          [[8, 24], [2, 20]],    // 左下
          [[2, 20], [2, 16]],    // 左竖线(下)
          [[2, 16], [8, 12]]     // 左下(上)
        ]
      },
      '9': {
        width: 16,
        strokes: [
          [[8, 20], [14, 16]],   // 右上
          [[14, 16], [14, 4]],   // 右竖线
          [[14, 4], [8, 0]],     // 右下
          [[8, 0], [2, 4]],      // 左下
          [[2, 4], [2, 10]],     // 左竖线
          [[2, 10], [8, 10]]     // 中横线
        ]
      },
      ' ': {
        width: 12,
        strokes: []
      }
    };
  }

  /**
   * 生成文本轨迹
   * @param {string} text - 输入文本
   * @param {Object} params - 书写参数
   * @returns {Object[]} 三维轨迹点数组
   */
  generateTrajectory(text, params = {}) {
    const config = { ...this.defaultParams, ...params };
    const trajectory = [];
    
    let currentX = 0;
    let currentY = 0;
    let isPenUp = true;

    for (const char of text.toUpperCase()) {
      if (char === '\n') {
        // 换行
        currentX = 0;
        currentY -= config.lineSpacing;
        continue;
      }

      const charData = this.fontData[char];
      if (!charData) {
        // 未知字符，跳过
        currentX += config.charSpacing;
        continue;
      }

      // 生成字符轨迹
      const charTrajectory = this.generateCharTrajectory(char, currentX, currentY, config);
      
      // 添加抬笔移动 (如果需要)
      if (!isPenUp && charTrajectory.length > 0) {
        const lastPoint = trajectory[trajectory.length - 1];
        const firstPoint = charTrajectory[0];
        
        // 插入抬笔指令
        trajectory.push({
          x: lastPoint.x,
          y: lastPoint.y,
          z: config.penUpHeight,
          penUp: true,
          speed: config.moveSpeed
        });
        
        // 空移到新字符起点
        trajectory.push({
          x: firstPoint.x,
          y: firstPoint.y,
          z: config.penUpHeight,
          penUp: true,
          speed: config.moveSpeed
        });
      }

      // 添加字符轨迹
      trajectory.push(...charTrajectory);
      isPenUp = false;

      // 更新位置
      currentX += charData.width * (config.fontSize / 20) + config.charSpacing;
    }

    // 最后抬笔
    if (trajectory.length > 0) {
      const lastPoint = trajectory[trajectory.length - 1];
      trajectory.push({
        x: lastPoint.x,
        y: lastPoint.y,
        z: config.penUpHeight,
        penUp: true,
        speed: config.moveSpeed
      });
    }

    this.logger.info(`Generated trajectory for "${text}": ${trajectory.length} points`);
    return trajectory;
  }

  /**
   * 生成单个字符轨迹
   */
  generateCharTrajectory(char, offsetX, offsetY, config) {
    const charData = this.fontData[char];
    if (!charData || !charData.strokes) {
      return [];
    }

    const trajectory = [];
    const scale = config.fontSize / 20; // 基准字号20mm

    for (const stroke of charData.strokes) {
      for (let i = 0; i < stroke.length; i++) {
        const point = stroke[i];
        const x = offsetX + point[0] * scale;
        const y = offsetY + (20 - point[1]) * scale; // Y轴翻转
        
        trajectory.push({
          x,
          y,
          z: config.writeDepth,
          penUp: false,
          speed: config.writeSpeed
        });
      }
    }

    return trajectory;
  }

  /**
   * 应用仿射变换
   * @param {Object[]} trajectory - 原始轨迹
   * @param {Object} transform - 变换参数 {scale, rotation, translation}
   * @returns {Object[]} 变换后的轨迹
   */
  applyAffineTransform(trajectory, transform) {
    const { 
      scale = { x: 1, y: 1 }, 
      rotation = 0, 
      translation = { x: 0, y: 0 }
    } = transform;

    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    return trajectory.map(point => {
      // 缩放
      let x = point.x * scale.x;
      let y = point.y * scale.y;

      // 旋转
      const rotatedX = x * cosR - y * sinR;
      const rotatedY = x * sinR + y * cosR;

      // 平移
      x = rotatedX + translation.x;
      y = rotatedY + translation.y;

      return {
        ...point,
        x,
        y
      };
    });
  }

  /**
   * 生成书写工作平面标定轨迹
   */
  generateCalibrationPattern() {
    const pattern = [];
    const size = 50; // 50mm x 50mm
    const step = 10; // 10mm间隔

    // 绘制网格
    for (let x = 0; x <= size; x += step) {
      pattern.push(
        { x, y: 0, z: 0, penUp: false, speed: 20 },
        { x, y: size, z: 0, penUp: false, speed: 20 },
        { x, y: size, z: 10, penUp: true, speed: 50 }
      );
    }

    for (let y = 0; y <= size; y += step) {
      pattern.push(
        { x: 0, y, z: 10, penUp: true, speed: 50 },
        { x: 0, y, z: 0, penUp: false, speed: 20 },
        { x: size, y, z: 0, penUp: false, speed: 20 },
        { x: size, y, z: 10, penUp: true, speed: 50 }
      );
    }

    return pattern;
  }

  /**
   * 生成测试图案 (圆形、方形等)
   */
  generateTestPattern(patternType = 'circle', size = 30) {
    const pattern = [];

    switch (patternType) {
      case 'circle':
        const points = 32;
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * 2 * Math.PI;
          const x = size/2 + (size/2) * Math.cos(angle);
          const y = size/2 + (size/2) * Math.sin(angle);
          pattern.push({
            x,
            y,
            z: i === 0 ? 10 : 0,
            penUp: i === 0,
            speed: 20
          });
        }
        // 闭合
        pattern.push({
          x: pattern[0].x,
          y: pattern[0].y,
          z: 10,
          penUp: true,
          speed: 50
        });
        break;

      case 'square':
        const square = [
          [0, 0], [size, 0], [size, size], [0, size], [0, 0]
        ];
        for (let i = 0; i < square.length; i++) {
          pattern.push({
            x: square[i][0],
            y: square[i][1],
            z: i === 0 ? 10 : 0,
            penUp: i === 0,
            speed: 20
          });
        }
        // 抬笔
        pattern.push({
          x: pattern[0].x,
          y: pattern[0].y,
          z: 10,
          penUp: true,
          speed: 50
        });
        break;

      case 'star':
        const starPoints = 5;
        for (let i = 0; i <= starPoints * 2; i++) {
          const angle = (i / (starPoints * 2)) * 2 * Math.PI;
          const radius = i % 2 === 0 ? size/2 : size/4;
          const x = size/2 + radius * Math.cos(angle);
          const y = size/2 + radius * Math.sin(angle);
          pattern.push({
            x,
            y,
            z: i === 0 ? 10 : 0,
            penUp: i === 0,
            speed: 20
          });
        }
        // 闭合
        pattern.push({
          x: pattern[0].x,
          y: pattern[0].y,
          z: 10,
          penUp: true,
          speed: 50
        });
        break;
    }

    return pattern;
  }

  /**
   * 优化轨迹 (减少不必要的抬笔)
   */
  optimizeTrajectory(trajectory) {
    const optimized = [];
    
    for (let i = 0; i < trajectory.length; i++) {
      const current = trajectory[i];
      
      // 移除连续的penUp指令
      if (current.penUp && i < trajectory.length - 1) {
        const next = trajectory[i + 1];
        if (next.penUp && 
            Math.abs(current.x - next.x) < 0.1 && 
            Math.abs(current.y - next.y) < 0.1) {
          continue; // 跳过重复的penUp
        }
      }
      
      optimized.push(current);
    }
    
    return optimized;
  }

  /**
   * 估算轨迹执行时间
   */
  estimateExecutionTime(trajectory) {
    let totalTime = 0;
    let prevPoint = null;
    
    for (const point of trajectory) {
      if (prevPoint) {
        const distance = Math.sqrt(
          Math.pow(point.x - prevPoint.x, 2) + 
          Math.pow(point.y - prevPoint.y, 2) + 
          Math.pow(point.z - prevPoint.z, 2)
        );
        totalTime += distance / point.speed;
      }
      prevPoint = point;
    }
    
    return totalTime;
  }
}

module.exports = HandwritingEngine;