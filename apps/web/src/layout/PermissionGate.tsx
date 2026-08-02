import React from "react";

export interface PermissionGateProps {
  permission: string;
  permissions: readonly string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  permission,
  permissions,
  children,
  fallback = null,
}) => {
  const hasAccess = permissions.includes(permission);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
