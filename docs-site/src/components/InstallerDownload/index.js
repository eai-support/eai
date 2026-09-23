import React, { useEffect, useState } from "react";
import styles from "./styles.module.css";

const releaseBase = "https://github.com/eai-support/eai-installer/releases/latest/download";

const installers = {
  "macos-arm64": {
    label: "macOS Apple Silicon",
    file: "eai-setup-macos-arm64.dmg",
    detail: "Apple Silicon",
  },
  "macos-x64": {
    label: "macOS Intel",
    file: "eai-setup-macos-x64.dmg",
    detail: "Intel",
  },
  "windows-arm64": {
    label: "Windows ARM64",
    file: "eai-setup-windows-arm64.exe",
    detail: "ARM64",
  },
  "windows-x64": {
    label: "Windows x64",
    file: "eai-setup-windows-x64.exe",
    detail: "x64",
  },
  "linux-arm64": {
    label: "Ubuntu/Debian ARM64",
    file: "eai-setup-ubuntu-arm64.deb",
    detail: "ARM64",
  },
  "linux-x64": {
    label: "Ubuntu/Debian x64",
    file: "eai-setup-ubuntu-amd64.deb",
    detail: "x64",
  },
};

function architectureFrom(value = "") {
  const architecture = value.toLowerCase();
  if (architecture.includes("arm") || architecture.includes("aarch")) return "arm64";
  if (architecture.includes("x86") || architecture.includes("intel") || architecture.includes("amd")) return "x64";
  return null;
}

function appleSiliconFromWebGL() {
  try {
    const context = document.createElement("canvas").getContext("webgl");
    const debug = context?.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug && context?.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    return typeof renderer === "string" && /apple\s+(m\d|gpu)/i.test(renderer);
  } catch {
    return false;
  }
}

async function detectInstaller() {
  const userAgentData = navigator.userAgentData;
  const highEntropy = userAgentData?.getHighEntropyValues
    ? await userAgentData.getHighEntropyValues(["architecture", "bitness", "platform"])
    : {};
  const platform = String(highEntropy.platform || userAgentData?.platform || navigator.platform || navigator.userAgent);
  const architecture = architectureFrom(highEntropy.architecture || navigator.userAgent);

  if (/win/i.test(platform)) return architecture === "arm64" ? "windows-arm64" : "windows-x64";
  if (/linux/i.test(platform)) return architecture === "arm64" ? "linux-arm64" : "linux-x64";
  if (/mac/i.test(platform)) {
    if (architecture === "arm64" || appleSiliconFromWebGL()) return "macos-arm64";
    if (architecture === "x64" && !appleSiliconFromWebGL()) return "macos-x64";
    return null;
  }
  return null;
}

function installerUrl(installer) {
  return `${releaseBase}/${installer.file}`;
}

export default function InstallerDownload() {
  const [recommended, setRecommended] = useState(undefined);
  const [macChoice, setMacChoice] = useState(null);

  useEffect(() => {
    let active = true;
    detectInstaller()
      .then((value) => active && setRecommended(value))
      .catch(() => active && setRecommended(null));
    return () => { active = false; };
  }, []);

  const selection = macChoice || recommended;
  const installer = selection ? installers[selection] : null;

  return <section className={styles.downloadPanel} aria-live="polite">
    <p className={styles.eyebrow}>Recommended for this computer</p>
    {recommended === undefined && <p className={styles.status}>Checking your operating system and processor.</p>}
    {installer && <>
      <h2>Download EAI Setup for {installer.label}</h2>
      <a className={styles.downloadButton} href={installerUrl(installer)}>Download now</a>
      <p className={styles.status}>We detected {installer.label}. Open the downloaded file to begin setup.</p>
    </>}
    {recommended === null && !macChoice && <>
      <h2>Choose an installer</h2>
      <p className={styles.status}>We could not identify a supported operating system and processor. Select a package below.</p>
      <div className={styles.choiceButtons}>
        <button type="button" onClick={() => setMacChoice("macos-arm64")}>macOS Apple Silicon</button>
        <button type="button" onClick={() => setMacChoice("macos-x64")}>macOS Intel</button>
      </div>
    </>}
    <details className={styles.alternatives}>
      <summary>Download a version</summary>
      <ul>
        {Object.entries(installers).filter(([key]) => key !== selection).map(([key, item]) =>
          <li key={key}><a href={installerUrl(item)}>{item.label}</a></li>,
        )}
      </ul>
    </details>
  </section>;
}
