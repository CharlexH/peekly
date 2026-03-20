export interface UAResult {
  browser: string;
  os: string;
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera\//, "Opera"],
  [/Vivaldi\//, "Vivaldi"],
  [/Brave/, "Brave"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
  [/MSIE|Trident\//, "IE"],
];

const OS_LIST: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
  [/CrOS/, "ChromeOS"],
];

export function parseUA(ua: string): UAResult {
  let browser = "Other";
  let os = "Other";

  for (const [pattern, name] of BROWSERS) {
    if (pattern.test(ua)) {
      browser = name;
      break;
    }
  }

  for (const [pattern, name] of OS_LIST) {
    if (pattern.test(ua)) {
      os = name;
      break;
    }
  }

  return { browser, os };
}
