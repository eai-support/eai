import React, { useEffect, useState } from "react";
import styles from "./styles.module.css";

const releaseBase = "https://github.com/eai-support/eai-installer/releases/latest/download";

const installers = {
  "macos-arm64": {
    label: "macOS Apple Silicon",
    file: "eai-setup-macos-arm64.dmg",
    detail: "Apple Silicon",
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
};

// EAI Setup is no longer built for Intel Macs or Linux, so those computers are
// told which platforms it supports instead of being offered a package.
const unsupported = "unsupported";
const availability = "EAI Setup is available for macOS on Apple Silicon and Windows (x64 and ARM64).";

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
  if (/linux/i.test(platform)) return unsupported;
  if (/mac/i.test(platform)) {
    if (architecture === "arm64" || appleSiliconFromWebGL()) return "macos-arm64";
    if (architecture === "x64" && !appleSiliconFromWebGL()) return unsupported;
    return null;
  }
  return null;
}

function installerUrl(installer) {
  return `${releaseBase}/${installer.file}`;
}

export default function InstallerDownload() {
  const [recommended, setRecommended] = useState(undefined);

  useEffect(() => {
    let active = true;
    detectInstaller()
      .then((value) => active && setRecommended(value))
      .catch(() => active && setRecommended(null));
    return () => { active = false; };
  }, []);

  const installer = recommended ? installers[recommended] : null;
  // Before detection resolves (and in the server-rendered HTML a no-JS visitor keeps) every installer is listed openly.
  const listsEveryInstaller = !installer;
  const listStatus = recommended === undefined ? "Checking your operating system and processor."
    : recommended === null ? `We could not identify a supported operating system and processor. ${availability}` : availability;

  return <section className={styles.downloadPanel} aria-live="polite">
    <p className={styles.eyebrow}>Recommended for this computer</p>
    {installer && <>
      <h2>Download EAI Setup for {installer.label}</h2>
      <a className={styles.downloadButton} href={installerUrl(installer)}>Download now</a>
      <p className={styles.status}>We detected {installer.label}. Open the downloaded file to begin setup.</p>
    </>}
    {listsEveryInstaller && <>
      <h2>Choose an installer</h2>
      <p className={styles.status}>{listStatus}</p>
      <div className={styles.choiceButtons}>
        {Object.entries(installers).map(([key, item]) =>
          <a key={key} href={installerUrl(item)}>{item.label}</a>,
        )}
      </div>
    </>}
    {!listsEveryInstaller && <details className={styles.alternatives}>
      <summary>Download a version</summary>
      <ul>
        {Object.entries(installers).filter(([key]) => key !== recommended).map(([key, item]) =>
          <li key={key}><a href={installerUrl(item)}>{item.label}</a></li>,
        )}
      </ul>
    </details>}
  </section>;
}
