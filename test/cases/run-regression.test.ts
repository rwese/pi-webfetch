/**
 * Regression Test Runner
 *
 * Runs all test cases from test/cases/ directory.
 * Each case is a .md file with YAML frontmatter containing metadata,
 * and optional `expected` and `assertions` code blocks.
 */

import { describe, it, expect, vi } from "vitest";
import { loadAllCases, loadCase } from "./index";
import type { TestCase, TestCaseFile } from "./types";

describe("Regression Test Cases", () => {
   const cases = loadAllCases();

   if (cases.length === 0) {
      it("has test cases defined", () => {
         // No test cases yet - informational
         console.log("\n📝 No regression test cases found.");
         console.log("   Run: npm run report-url -- --url <url> --issue '<desc>' to add one.");
      });
      return;
   }

   for (const caseFile of cases) {
      const testCase = caseFile.case;

      describe(`${testCase.id}`, () => {
         it(`has valid metadata`, () => {
            expect(testCase.id).toBeTruthy();
            expect(testCase.url).toMatch(/^https?:\/\//);
            expect(testCase.issue).toBeTruthy();
            expect(["pending", "passing", "failing"]).toContain(testCase.status);
         });

         if (testCase.actual) {
            it(`has captured actual output (${testCase.actual.length} chars)`, () => {
               expect(testCase.actual).toBeTruthy();
            });
         }

         if (testCase.expected) {
            it(`has expected output defined`, () => {
               expect(testCase.expected).toBeTruthy();
            });

            if (testCase.actual && testCase.status !== "passing") {
               it(`matches expected output (snapshot test)`, () => {
                  // Normalize whitespace for comparison
                  const normalize = (s: string) =>
                     s.replace(/\r\n/g, "\n").trim();
                  expect(normalize(testCase.actual!)).toBe(
                     normalize(testCase.expected!),
                  );
               });
            }
         }

         if (caseFile.assertions) {
            it(`runs custom assertions`, () => {
               const assertions = caseFile.assertions!;
               const actual = testCase.actual || "";

               // Parse and run simple assertions
               const lines = assertions.split("\n").filter((l) => l.trim());
               for (const line of lines) {
                  // Split only on first colon to handle values containing colons
                  const colonIndex = line.indexOf(":");
                  const assertion = line.slice(0, colonIndex).trim();
                  const expected = line.slice(colonIndex + 1).trim();

                  switch (assertion) {
                     case "contains":
                        expect(actual).toContain(expected);
                        break;
                     case "not_contains":
                        expect(actual).not.toContain(expected);
                        break;
                     case "starts_with":
                        expect(actual).toMatch(new RegExp(`^${escapeRegex(expected)}`));
                        break;
                     case "ends_with":
                        expect(actual).toMatch(new RegExp(`${escapeRegex(expected)}$`));
                        break;
                     case "matches":
                        expect(actual).toMatch(new RegExp(expected));
                        break;
                     case "has_length":
                        const len = parseInt(expected, 10);
                        expect(actual.length).toBe(len);
                        break;
                     case "has_lines":
                        const lineCount = actual.split("\n").length;
                        const [op, count] = expected.split(" ");
                        if (op === "=") {
                           expect(lineCount).toBe(parseInt(count, 10));
                        } else if (op === ">") {
                           expect(lineCount).toBeGreaterThan(parseInt(count, 10));
                        } else if (op === "<") {
                           expect(lineCount).toBeLessThan(parseInt(count, 10));
                        }
                        break;
                     default:
                        throw new Error(`Unknown assertion: ${assertion}`);
                  }
               }
            });
         }

         if (testCase.status === "pending") {
            it(`is marked as pending (needs review)`, () => {
               // This test always passes, just marks the case as needing attention
               expect(true).toBe(true);
            });
         }
      });
   }
});

function escapeRegex(str: string): string {
   return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("Test Case Statistics", () => {
   it("shows test case summary", () => {
      const cases = loadAllCases();
      const byStatus = {
         pending: cases.filter((c) => c.case.status === "pending").length,
         passing: cases.filter((c) => c.case.status === "passing").length,
         failing: cases.filter((c) => c.case.status === "failing").length,
      };

      console.log("\n📊 Test Case Summary:");
      console.log(`   Total: ${cases.length}`);
      console.log(`   Pending: ${byStatus.pending}`);
      console.log(`   Passing: ${byStatus.passing}`);
      console.log(`   Failing: ${byStatus.failing}`);

      expect(cases.length).toBeGreaterThanOrEqual(0);
   });
});
