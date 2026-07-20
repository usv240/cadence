export type GazeFeature = {
  x: number;
  y: number;
  confidence: number;
};

export type GazeCalibrationSample = GazeFeature & {
  targetX: number;
  targetY: number;
};

export type GazeCalibration = {
  version: 2;
  x: [number, number, number];
  y: [number, number, number];
  samples: number;
  createdAt: number;
};

export type EyeGazeSettings = {
  consented: boolean;
  calibration: GazeCalibration | null;
  speed: GazeFocusSpeed;
};

export const gazeFocusSpeeds = ["steady", "balanced", "responsive"] as const;
export type GazeFocusSpeed = (typeof gazeFocusSpeeds)[number];
export const eyeGazeSettingsKey = "cadence.eyeGaze";
export const emptyEyeGazeSettings: EyeGazeSettings = { consented: false, calibration: null, speed: "balanced" };

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

export function sanitizeEyeGazeSettings(value: unknown): EyeGazeSettings {
  if (!value || typeof value !== "object") return emptyEyeGazeSettings;
  const source = value as Partial<EyeGazeSettings>;
  const speed = gazeFocusSpeeds.includes(source.speed as GazeFocusSpeed) ? source.speed as GazeFocusSpeed : "balanced";
  const calibration = source.calibration;
  if (!calibration || typeof calibration !== "object") return { consented: Boolean(source.consented), calibration: null, speed };
  const candidate = calibration as Partial<GazeCalibration>;
  const validVector = (vector: unknown): vector is [number, number, number] => Array.isArray(vector) && vector.length === 3 && vector.every(finite);
  if (candidate.version !== 2 || !validVector(candidate.x) || !validVector(candidate.y) || !finite(candidate.samples) || !finite(candidate.createdAt)) return { consented: Boolean(source.consented), calibration: null, speed };
  const x = candidate.x;
  const y = candidate.y;
  const samples = candidate.samples as number;
  const createdAt = candidate.createdAt as number;
  return {
    consented: Boolean(source.consented),
    calibration: {
      version: 2,
      x,
      y,
      samples: Math.max(0, Math.min(9, Math.round(samples))),
      createdAt,
    },
    speed,
  };
}

function solve3x3(matrix: number[][], vector: number[]) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let bestRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[bestRow][pivot])) bestRow = row;
    if (Math.abs(augmented[bestRow][pivot]) < 0.000001) return null;
    [augmented[pivot], augmented[bestRow]] = [augmented[bestRow], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column < 4; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column < 4; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }
  return augmented.map((row) => row[3]) as [number, number, number];
}

export function buildGazeCalibration(samples: GazeCalibrationSample[]): GazeCalibration | null {
  if (samples.length < 5) return null;
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const targetX = [0, 0, 0];
  const targetY = [0, 0, 0];
  for (const sample of samples) {
    const feature = [sample.x, sample.y, 1];
    for (let row = 0; row < 3; row += 1) {
      targetX[row] += feature[row] * sample.targetX;
      targetY[row] += feature[row] * sample.targetY;
      for (let column = 0; column < 3; column += 1) normal[row][column] += feature[row] * feature[column];
    }
  }
  const x = solve3x3(normal, targetX);
  const y = solve3x3(normal, targetY);
  if (!x || !y) return null;
  return { version: 2, x, y, samples: samples.length, createdAt: Date.now() };
}

export function estimateGazePoint(feature: GazeFeature, calibration: GazeCalibration) {
  const values = [feature.x, feature.y, 1];
  const apply = (weights: [number, number, number]) => weights.reduce((sum, weight, index) => sum + weight * values[index], 0);
  const x = apply(calibration.x);
  const y = apply(calibration.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), confidence: feature.confidence };
}
