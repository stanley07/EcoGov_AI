import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test, expect } from "vitest";
import { MigrationRunner } from "./index.js";

describe("Database Migration Runner Checks", () => {
  test("checksum helper returns deterministic SHA-256 values", () => {
    const runner = new MigrationRunner();
    const sql = "CREATE TABLE users (id UUID PRIMARY KEY);";
    const hash1 = runner.calculateChecksum(sql);
    const hash2 = runner.calculateChecksum(sql);
    const hash3 = runner.calculateChecksum(sql + "\n");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64);
  });

  test("filename scanner parses structured versions correctly", () => {
    // Create mock migrations folder structure programmatically
    const mockDir = path.resolve(__dirname, "./_mock_migrations");
    if (!fs.existsSync(mockDir)) {
      fs.mkdirSync(mockDir);
    }
    fs.writeFileSync(path.join(mockDir, "000001_first.sql"), "SELECT 1;");
    fs.writeFileSync(path.join(mockDir, "000002_second.sql"), "SELECT 2;");

    try {
      const runner = new MigrationRunner(mockDir);
      const files = runner.getMigrationFiles();

      expect(files).toHaveLength(2);
      expect(files[0]?.version).toBe(1);
      expect(files[1]?.version).toBe(2);
      expect(files[0]?.name).toBe("first");
    } finally {
      // Clean up mock folder files
      fs.unlinkSync(path.join(mockDir, "000001_first.sql"));
      fs.unlinkSync(path.join(mockDir, "000002_second.sql"));
      fs.rmdirSync(mockDir);
    }
  });

  test("invalid migration filenames trigger clear errors", () => {
    const mockDir = path.resolve(__dirname, "./_mock_migrations_err");
    if (!fs.existsSync(mockDir)) {
      fs.mkdirSync(mockDir);
    }
    fs.writeFileSync(path.join(mockDir, "invalid_name.sql"), "SELECT 1;");

    try {
      const runner = new MigrationRunner(mockDir);
      expect(() => runner.getMigrationFiles()).toThrow(
        "Invalid migration filename format",
      );
    } finally {
      fs.unlinkSync(path.join(mockDir, "invalid_name.sql"));
      fs.rmdirSync(mockDir);
    }
  });
});
