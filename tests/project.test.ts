import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { discoverSourceFiles, summarizeProject } from "../src/project.js";

describe("project source discovery", () => {
  it("discovers configured source globs in stable order", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "examples"), { recursive: true });
    mkdirSync(join(dir, "src", "nested"), { recursive: true });
    writeFileSync(join(dir, "examples", "commerce.dl"), "module commerce\n");
    writeFileSync(join(dir, "src", "app.dl"), "module app\n");
    writeFileSync(join(dir, "src", "nested", "billing.dl"), "module billing\n");
    writeFileSync(join(dir, "src", "nested", "ignored.txt"), "nope\n");

    const files = discoverSourceFiles(
      {
        ...defaultConfig,
        sources: ["src/**/*.dl", "examples/*.dl"],
      },
      dir,
    );

    expect(files.map((file) => file.relativePath)).toEqual(["examples/commerce.dl", "src/app.dl", "src/nested/billing.dl"]);
  });

  it("deduplicates files matched by multiple source patterns", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "examples"), { recursive: true });
    writeFileSync(join(dir, "examples", "commerce.dl"), "module commerce\n");

    const files = discoverSourceFiles(
      {
        ...defaultConfig,
        sources: ["examples/*.dl", "examples/commerce.dl"],
      },
      dir,
    );

    expect(files.map((file) => file.relativePath)).toEqual(["examples/commerce.dl"]);
  });

  it("summarizes configured source files", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "examples"), { recursive: true });
    writeFileSync(
      join(dir, "examples", "commerce.dl"),
      `module commerce

entity User {
  id: Id<User> primary generated
}

enum Status {
  Pending
}

query users(): Query<User> =
  from user in User
  select user

transaction function touchUser(userRef: User) writes User {
  let user = load userRef for update
  save user
}
`,
    );

    const summary = summarizeProject(
      {
        ...defaultConfig,
        sources: ["examples/*.dl"],
      },
      dir,
    );

    expect(summary).toEqual({
      files: [
        {
          path: "examples/commerce.dl",
          moduleName: "commerce",
          entities: ["User"],
          enums: ["Status"],
          queries: ["users"],
          transactions: ["touchUser"],
        },
      ],
      diagnostics: [],
      totals: {
        files: 1,
        entities: 1,
        enums: 1,
        queries: 1,
        transactions: 1,
      },
    });
  });

  it("reports duplicate declarations across project files", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "examples"), { recursive: true });
    writeFileSync(
      join(dir, "examples", "a.dl"),
      `module commerce

entity User {
  id: Id<User> primary generated
}
`,
    );
    writeFileSync(
      join(dir, "examples", "b.dl"),
      `module commerce

entity User {
  id: Id<User> primary generated
}
`,
    );

    const summary = summarizeProject(
      {
        ...defaultConfig,
        sources: ["examples/*.dl"],
      },
      dir,
    );

    expect(summary.diagnostics).toEqual([
      "duplicate entity commerce.User across examples/a.dl, examples/b.dl",
    ]);
  });
});

function makeTempDir(): string {
  const dir = join(tmpdir(), `dl-project-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
