/**
 * Integration tests for FileController.
 * Require DATABASE_URL and a running PostgreSQL.
 */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { FileController } from "../file.controller";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import { UserDatabaseAdapter, FileDatabaseAdapter } from "../../adapters/database.adapter";
import { getUploadsPath } from "../../lib/paths";
import * as fs from "fs";

describe("FileController Integration", () => {
  const controller = new FileController();
  const userAdapter = new UserDatabaseAdapter();
  const fileAdapter = new FileDatabaseAdapter();
  let testUserId: string;
  const testEmail = `test-file-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      await fileAdapter.deleteByUserId(existingUser.id);
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test File User",
      intro: "Test",
      location: "City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) {
      const userDir = getUploadsPath("files", testUserId);
      if (fs.existsSync(userDir)) {
        for (const name of fs.readdirSync(userDir)) fs.unlinkSync(`${userDir}/${name}`);
        fs.rmdirSync(userDir);
      }
      await fileAdapter.deleteByUserId(testUserId);
      await userAdapter.deleteById(testUserId);
    }
  });

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test File User",
  });

  describe("POST '' (upload)", () => {
    test("should return 400 when no file in multipart body", async () => {
      const formData = new FormData();
      const req = new Request("http://localhost/files", { method: "POST", body: formData });
      const res = await controller.upload(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("should return 200 and file record when valid file uploaded", async () => {
      const content = "file controller test content";
      const file = new File([content], "hello.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const req = new Request("http://localhost/files", { method: "POST", body: formData });

      const res = await controller.upload(req, mockUser());
      const data = (await res.json()) as { message?: string; file?: { id: string; name: string; size: string; type: string; url: string } };

      expect(res.status).toBe(200);
      expect(data.message).toBe("File uploaded successfully");
      expect(data.file).toBeDefined();
      expect(data.file!.name).toBe("hello.txt");
      expect(data.file!.size).toBe(String(content.length));
      expect(data.file!.type).toBe("text/plain");
      expect(data.file!.url).toContain("/uploads/files/");
    });
  });

  describe("GET '' (list)", () => {
    test("should return 200 with files and pagination", async () => {
      const req = new Request("http://localhost/files?page=1&limit=10");
      const res = await controller.list(req, mockUser());
      const data = (await res.json()) as { files: unknown[]; pagination?: unknown };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.files)).toBe(true);
      expect(data.pagination).toBeDefined();
    });
  });

  describe("DELETE /:id", () => {
    test("should return 404 when file id does not exist", async () => {
      const req = new Request("http://localhost/files/00000000-0000-0000-0000-000000000000", { method: "DELETE" });
      const res = await controller.delete(req, mockUser(), { id: "00000000-0000-0000-0000-000000000000" });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("File not found");
    });

    test("should return 200 and success when file exists", async () => {
      const content = "to delete";
      const file = new File([content], "delete-me.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      const uploadReq = new Request("http://localhost/files", { method: "POST", body: formData });
      const uploadRes = await controller.upload(uploadReq, mockUser());
      const uploadData = (await uploadRes.json()) as { file?: { id: string } };
      const fileId = uploadData.file!.id;

      const req = new Request("http://localhost/files/" + fileId, { method: "DELETE" });
      const res = await controller.delete(req, mockUser(), { id: fileId });
      const data = (await res.json()) as { success?: boolean };

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
