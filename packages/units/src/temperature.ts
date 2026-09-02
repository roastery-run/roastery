/**
 * Temperature, and the one conversion everybody gets wrong.
 *
 * Storage is Celsius. A US roaster reads Fahrenheit off the machine, so the
 * console converts for display only.
 */
export type TemperatureUnit = "C" | "F";

export function toCelsius(value: number, unit: TemperatureUnit): number {
  return unit === "C" ? value : ((value - 32) * 5) / 9;
}

export function fromCelsius(celsius: number, unit: TemperatureUnit): number {
  return unit === "C" ? celsius : (celsius * 9) / 5 + 32;
}

/**
 * Rate of rise converts by SCALE ONLY.
 *
 * A RoR is a difference of temperatures per minute, so the +32 offset cancels
 * and applying the point-temperature formula to it is simply wrong — it turns
 * a 10 °C/min ramp into 50 °F/min instead of 18. This is the single most common
 * bug in roast-logging software, and it is why the conversion has its own
 * function rather than reusing the one above.
 */
export function convertRateOfRise(value: number, to: TemperatureUnit): number {
  return to === "C" ? value : (value * 9) / 5;
}

export function formatTemperature(
  celsius: number | null | undefined,
  unit: TemperatureUnit = "C",
  digits = 1,
): string {
  if (celsius === null || celsius === undefined || !Number.isFinite(celsius)) return "—";
  return `${fromCelsius(celsius, unit).toFixed(digits)}°${unit}`;
}
