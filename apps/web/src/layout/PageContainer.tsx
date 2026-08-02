import React from "react";
import { AppErrorBoundary } from "./AppErrorBoundary.js";

export interface PageContainerProps {
  children: React.ReactNode;
}

export const PageContainer: React.FC<PageContainerProps> = ({ children }) => {
  return (
    <AppErrorBoundary>
      <div
        style={{
          width: "100%",
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "24px",
          boxSizing: "border-box",
          animation: "fadeIn 0.25s ease-out",
        }}
      >
        {children}
      </div>
    </AppErrorBoundary>
  );
};
