import React, { useEffect, useRef, useState } from "react";

export interface AppShellProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  topBar: React.ReactNode;
  pageTitle: string;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  sidebar,
  topBar,
  pageTitle,
}) => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef("");

  // Toggle body scroll locking when mobile sidebar is toggled
  useEffect(() => {
    if (isMobileSidebarOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      previousBodyOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      // Move focus to the drawer container or first focusable element
      if (drawerRef.current) {
        const focusableElements = drawerRef.current.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex="0"]',
        );
        if (focusableElements.length > 0) {
          (focusableElements[0] as HTMLElement).focus();
        } else {
          drawerRef.current.focus();
        }
      }
    } else {
      document.body.style.overflow = previousBodyOverflowRef.current;
      // Restore focus to the toggle button
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    }

    return () => {
      document.body.style.overflow = previousBodyOverflowRef.current;
    };
  }, [isMobileSidebarOpen]);

  // Focus trap keyboard handler
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isMobileSidebarOpen) return;

    if (e.key === "Escape") {
      setIsMobileSidebarOpen(false);
      return;
    }

    if (e.key === "Tab" && drawerRef.current) {
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex="0"]',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (first && last) {
        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    }
  };

  // Skip link handler
  const handleSkipToContent = (e: React.MouseEvent) => {
    e.preventDefault();
    if (mainContentRef.current) {
      mainContentRef.current.focus();
      mainContentRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Inject mobile toggle callback into TopBar if it is a React component
  const clonedTopBar = React.isValidElement<{
    onOpenMobileSidebar?: () => void;
    isMobileSidebarOpen?: boolean;
  }>(topBar)
    ? React.cloneElement(topBar, {
        onOpenMobileSidebar: () => setIsMobileSidebarOpen(true),
        isMobileSidebarOpen: isMobileSidebarOpen,
      })
    : topBar;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#0f172a",
        color: "#f1f5f9",
        fontFamily: "'Inter', sans-serif",
        position: "relative",
        boxSizing: "border-box",
        width: "100vw",
        overflowX: "hidden",
      }}
      onKeyDown={handleKeyDown}
    >
      {/* 1. Accessibility Skip Link */}
      <a
        href="#main-content"
        onClick={handleSkipToContent}
        style={{
          position: "absolute",
          top: "-100px",
          left: "20px",
          background: "#38bdf8",
          color: "#0f172a",
          padding: "12px 24px",
          borderRadius: "6px",
          fontWeight: "bold",
          zIndex: 10000,
          transition: "top 0.2s ease",
          outline: "none",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.top = "20px";
        }}
        onBlur={(e) => {
          e.currentTarget.style.top = "-100px";
        }}
      >
        Skip to main content
      </a>

      {/* 2. Desktop Navigation Sidebar */}
      <div
        style={{
          width: "260px",
          height: "100vh",
          position: "sticky",
          top: 0,
          flexShrink: 0,
        }}
        className="desktop-sidebar-container"
      >
        {sidebar}
      </div>

      {/* 3. Main Workspace Area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: "100vh",
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        {/* Top Header Navigation */}
        {clonedTopBar}

        {/* Focusable Page Area landmark */}
        <main
          id="main-content"
          ref={mainContentRef}
          tabIndex={-1}
          aria-label={pageTitle}
          style={{
            flex: 1,
            outline: "none",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </main>
      </div>

      {/* 4. Mobile Drawer Sidebar (Toggled State) */}
      {isMobileSidebarOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
          }}
          id="mobile-sidebar-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          {/* Backdrop (Dark tint overlay) */}
          <div
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(15, 23, 42, 0.75)",
              backdropFilter: "blur(4px)",
              transition: "opacity 0.25s ease",
            }}
          />

          {/* Drawer Panel Container */}
          <div
            ref={drawerRef}
            tabIndex={-1}
            style={{
              position: "relative",
              width: "280px",
              height: "100%",
              background: "#1e293b",
              boxShadow: "4px 0 24px rgba(0, 0, 0, 0.5)",
              display: "flex",
              flexDirection: "column",
              animation: "slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              outline: "none",
            }}
          >
            {/* Close toggle button inside drawer header */}
            <div
              style={{
                padding: "16px",
                display: "flex",
                justifyContent: "flex-end",
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setIsMobileSidebarOpen(false)}
                aria-label="Close navigation menu"
                style={{
                  width: "44px",
                  height: "44px",
                  background: "transparent",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  color: "#cbd5e1",
                  cursor: "pointer",
                  fontSize: "1.2rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  outline: "none",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = "0 0 0 2px #38bdf8";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                ✕
              </button>
            </div>

            {/* Sidebar content container */}
            <div style={{ flex: 1, overflowY: "auto" }}>{sidebar}</div>
          </div>
        </div>
      )}

      {/* Responsive media query overrides */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (max-width: 1024px) {
          .desktop-sidebar-container {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
