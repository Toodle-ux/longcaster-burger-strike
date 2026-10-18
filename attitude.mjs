const radians = Math.PI / 180;

// Earth-up vector in the device frame; rear camera points along negative Z.
// Alpha (compass heading) is unnecessary for a horizon and pitch ladder.
export function attitude(beta, gamma, screenAngle = 0) {
  if (![beta, gamma, screenAngle].every(Number.isFinite)) return null;
  const b = beta * radians, g = gamma * radians, a = screenAngle * radians;
  const x = -Math.cos(b) * Math.sin(g), y = Math.sin(b), z = Math.cos(b) * Math.cos(g);
  const right = x * Math.cos(a) - y * Math.sin(a);
  const up = x * Math.sin(a) + y * Math.cos(a);
  return {
    pitch: Math.asin(Math.max(-1, Math.min(1, -z))) / radians,
    // Looking straight up/down has no unique horizon; preserve the previous roll.
    roll: Math.hypot(right, up) < 0.025 ? null : Math.atan2(right, up) / radians,
  };
}

export function smoothAngle(current, target, fraction) {
  const delta = ((target - current + 540) % 360 + 360) % 360 - 180;
  return current + delta * fraction;
}
