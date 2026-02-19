/**
 * Integration tests for UploadController.
 * Require DATABASE_URL and a running PostgreSQL (same as other controller specs).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { UploadController } from "../upload.controller";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import { UserDatabaseAdapter, FileDatabaseAdapter } from "../../adapters/database.adapter";
import { getUploadsPath } from '../../lib/paths';
import * as fs from 'fs';

describe("UploadController Integration", () => {
  const controller = new UploadController();
  const userAdapter = new UserDatabaseAdapter();
  const fileAdapter = new FileDatabaseAdapter();
  let testUserId: string;
  let emptyListUserId: string;
  const testEmail = `test-upload-controller-${Date.now()}@example.com`;
  const emptyListEmail = `test-upload-controller-empty-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      await fileAdapter.deleteByUserId(existingUser.id);
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Upload User",
      intro: "Test user for upload controller",
      location: "Test City",
    });
    testUserId = user.id;

    const emptyUser = await userAdapter.create({
      email: emptyListEmail,
      name: "Empty List User",
      intro: "User with no files",
      location: "Test City",
    });
    emptyListUserId = emptyUser.id;
  });

  afterAll(async () => {
    if (testUserId) {
      const userDir = getUploadsPath('files', testUserId);
      if (fs.existsSync(userDir)) {
        const entries = fs.readdirSync(userDir);
        for (const name of entries) {
          fs.unlinkSync(`${userDir}/${name}`);
        }
        fs.rmdirSync(userDir);
      }
      await fileAdapter.deleteByUserId(testUserId);
      await userAdapter.deleteById(testUserId);
    }
    if (emptyListUserId) {
      await fileAdapter.deleteByUserId(emptyListUserId);
      await userAdapter.deleteById(emptyListUserId);
    }
    // Do not close db: other integration specs may run in the same process.
  });

  const getMockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Upload User",
  });

  describe("upload", () => {
    test("should return 400 when no file is uploaded", async () => {
      const formData = new FormData();
      const req = new Request("http://test/uploads", {
        method: "POST",
        body: formData,
      });

      const result = await controller.upload(req, getMockUser());

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe("No file uploaded");
    });

    test("should return 400 when file field is a string", async () => {
      const formData = new FormData();
      formData.append("file", "not-a-file");
      const req = new Request("http://test/uploads", {
        method: "POST",
        body: formData,
      });

      const result = await controller.upload(req, getMockUser());

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe("No file uploaded");
    });

    test("should return 400 for unsupported file type", async () => {
      const file = new File(["binary content"], "script.exe", { type: "application/x-msdownload" });
      const formData = new FormData();
      formData.append("file", file);
      const req = new Request("http://test/uploads", {
        method: "POST",
        body: formData,
      });

      const result = await controller.upload(req, getMockUser());

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("not supported");
    });

    test("should upload a valid file and return file record", async () => {
      const content = "Hello, this is a test file for the upload controller.";
      const file = new File([content], "test-upload.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const req = new Request("http://test/uploads", {
        method: "POST",
        body: formData,
      });

      const result = await controller.upload(req, getMockUser());

      expect(result).not.toBeInstanceOf(Response);
      const data = result as { message: string; file: { id: string; name: string; size: string; type: string; createdAt: string; url: string } };
      expect(data.message).toBe("File uploaded successfully");
      expect(data.file).toBeDefined();
      expect(data.file.id).toBeDefined();
      expect(data.file.name).toBe("test-upload.txt");
      expect(data.file.size).toBe(String(content.length));
      expect(data.file.type).toBe("text/plain");
      expect(data.file.createdAt).toBeDefined();
      expect(data.file.url).toContain("/uploads/files/");
      expect(data.file.url).toContain(testUserId);
      expect(data.file.url).toEndWith(".txt");
    });

    test("should persist file to DB and disk", async () => {
      const content = "Persist me.";
      const file = new File([content], "persist.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const req = new Request("http://test/uploads", { method: "POST", body: formData });

      const result = await controller.upload(req, getMockUser()) as { file: { id: string; name: string } };
      const fileId = result.file.id;

      const row = await fileAdapter.getByIdUnscoped(fileId);
      expect(row).not.toBeNull();
      expect(row!.name).toBe("persist.txt");
      expect(row!.userId).toBe(testUserId);

      const userDir = getUploadsPath('files', testUserId);
      const pathToFile = `${userDir}/${fileId}.txt`;
      expect(fs.existsSync(pathToFile)).toBe(true);
      expect(fs.readFileSync(pathToFile, 'utf8')).toBe(content);
    });
  });

  describe("list", () => {
    test("should return empty list when user has no files", async () => {
      const emptyUser: AuthenticatedUser = {
        id: emptyListUserId,
        email: emptyListEmail,
        name: "Empty List User",
      };
      const req = new Request("http://test/uploads?page=1&limit=10");
      const result = await controller.list(req, emptyUser);

      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("pagination");
      const data = result as { files: unknown[]; pagination: { current: number; total: number; count: number; totalCount: number } };
      expect(Array.isArray(data.files)).toBe(true);
      expect(data.files.length).toBe(0);
      expect(data.pagination.current).toBe(1);
      expect(data.pagination.totalCount).toBe(0);
    });

    test("should return uploaded files with pagination", async () => {
      const file = new File(["list test"], "list-me.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const uploadReq = new Request("http://test/uploads", { method: "POST", body: formData });
      await controller.upload(uploadReq, getMockUser());

      const listReq = new Request("http://test/uploads?page=1&limit=10");
      const result = await controller.list(listReq, getMockUser());

      const data = result as { files: Array<{ id: string; name: string; url: string }>; pagination: { current: number; totalCount: number } };
      expect(data.files.length).toBeGreaterThanOrEqual(1);
      const listFile = data.files.find((f) => f.name === "list-me.txt");
      expect(listFile).toBeDefined();
      expect(listFile!.url).toContain("/uploads/files/");
      expect(data.pagination.current).toBe(1);
      expect(data.pagination.totalCount).toBeGreaterThanOrEqual(1);
    });

    test("should respect page and limit query params", async () => {
      const req = new Request("http://test/uploads?page=2&limit=5");
      const result = await controller.list(req, getMockUser());

      const data = result as { pagination: { current: number; total: number; count: number; totalCount: number } };
      expect(data.pagination.current).toBe(2);
      expect(data.pagination.total).toBeDefined();
      expect(data.pagination.count).toBeLessThanOrEqual(5);
    });
  });
});
