import React from "react";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import styles from "./styles.module.css";

export default function PageFeedback() {
  const { siteConfig } = useDocusaurusContext();
  const configuredUrl = siteConfig.customFields?.documentationFeedbackUrl || "";
  const sendFeedback = (rating) => {
    const page = `${window.location.origin}${window.location.pathname}`;
    const fallback = `mailto:docs@enterpriseaigroup.com?subject=${encodeURIComponent(`Documentation feedback: ${rating}`)}&body=${encodeURIComponent(`Page: ${page}\n\nFeedback:`)}`;
    const target = configuredUrl ? `${configuredUrl}${configuredUrl.includes("?") ? "&" : "?"}rating=${encodeURIComponent(rating)}&page=${encodeURIComponent(page)}` : fallback;
    window.open(target, "_blank", "noopener,noreferrer");
  };
  return <div className={styles.feedback}><span>Was this page useful?</span><button type="button" onClick={() => sendFeedback("helpful")}>Yes</button><button type="button" onClick={() => sendFeedback("needs-work")}>Needs work</button></div>;
}
