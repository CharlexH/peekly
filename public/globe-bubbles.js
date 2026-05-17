const DEFAULTS = {
  minIntensity: 0.18,
  minRadius: 0.035,
  maxRadius: 0.145,
  minHeight: 0.012,
  maxHeight: 0.052,
  minOpacity: 0.24,
  maxOpacity: 0.66,
  baseColor: [110, 160, 28],
  peakColor: [202, 244, 94],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

function toHex(value) {
  return Math.round(value).toString(16).padStart(2, "0");
}

function colorForIntensity(intensity) {
  const r = lerp(DEFAULTS.baseColor[0], DEFAULTS.peakColor[0], intensity);
  const g = lerp(DEFAULTS.baseColor[1], DEFAULTS.peakColor[1], intensity);
  const b = lerp(DEFAULTS.baseColor[2], DEFAULTS.peakColor[2], intensity);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function bubbleVisual(visitors, maxVisitors, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  if (!Number.isFinite(visitors) || visitors <= 0 || !Number.isFinite(maxVisitors) || maxVisitors <= 0) {
    return {
      intensity: 0,
      radius: settings.minRadius,
      height: settings.minHeight,
      opacity: settings.minOpacity,
      color: colorForIntensity(0),
    };
  }

  const ratio = clamp(visitors / maxVisitors, 0, 1);
  const eased = Math.sqrt(ratio);
  const intensity = settings.minIntensity + (1 - settings.minIntensity) * eased;

  return {
    intensity,
    radius: lerp(settings.minRadius, settings.maxRadius, intensity),
    height: lerp(settings.minHeight, settings.maxHeight, intensity),
    opacity: lerp(settings.minOpacity, settings.maxOpacity, intensity),
    color: colorForIntensity(intensity),
  };
}

export function buildCountryBubbleSpecs(countries, countryCoords, options = {}) {
  const validCountries = (countries || []).filter((country) => {
    const hasCoords = Array.isArray(countryCoords?.[country.country]) && countryCoords[country.country].length === 2;
    return hasCoords && Number(country.visitors) > 0;
  });

  const maxVisitors = Math.max(...validCountries.map((country) => Number(country.visitors)), 0);

  return validCountries
    .map((country) => {
      const [lat, lng] = countryCoords[country.country];
      return {
        country: country.country,
        lat,
        lng,
        visitors: Number(country.visitors),
        ...bubbleVisual(Number(country.visitors), maxVisitors, options),
      };
    })
    .sort((left, right) => right.visitors - left.visitors);
}
