import React from "react";
import { AppErrorBoundary } from "./AppErrorBoundary.js";

export interface PageContainerProps {
  children: React.ReactNode;
  labelledBy?: string;
}

export const PageContainer: React.FC<PageContainerProps> = ({ children, labelledBy }) => {
  return (
    <AppErrorBoundary>
      <div
        aria-labelledby={labelledBy}
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
