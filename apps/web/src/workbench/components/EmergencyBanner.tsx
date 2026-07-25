export function EmergencyBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        background: "#7f1d1d",
        border: "2px solid #ef4444",
        borderRadius: "8px",
        padding: "15px",
        marginBottom: "20px",
        color: "#fca5a5",
        fontWeight: "bold",
      }}
    >
      <span style={{ marginRight: "8px" }} aria-hidden="true">⚠️</span>
      <strong>CRITICAL EMERGENCY DETECTED:</strong> {message}
    </div>
  );
}
