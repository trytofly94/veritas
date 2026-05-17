import { describe, it, expect } from "vitest";
import { renderUploadPage } from "../../src/views/upload.js";

/**
 * Regression tests for D-11 apiKey injection breaking Alpine binding.
 *
 * The original implementation used JSON.stringify(apiKey) inside a double-quoted
 * HTML attribute, which produced `x-data="uploadForm("...")"` — Alpine saw only
 * `uploadForm(` and the data binding failed silently at runtime. Tests using
 * regex on the rendered HTML did not catch this.
 */
describe("renderUploadPage", () => {
  it("emits a syntactically valid x-data attribute when apiKey contains a double quote", () => {
    const html = renderUploadPage({ apiKey: 'has"quote' });
    const match = html.match(/x-data='([^']*)'/);
    expect(match, "x-data must be wrapped in single quotes").not.toBeNull();
    // The JSON.stringify output should be intact inside the single-quoted attribute.
    expect(match![1]).toContain('uploadForm(');
    expect(match![1]).toMatch(/uploadForm\("has\\"quote"\)/);
  });

  it("loads upload.js before alpine.min.js so window.uploadForm exists when Alpine starts", () => {
    const html = renderUploadPage({ apiKey: "k" });
    const uploadIdx = html.indexOf("/static/upload.js");
    const alpineIdx = html.indexOf("/static/alpine.min.js");
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(alpineIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeLessThan(alpineIdx);
  });

  it("escapes single quotes in the apiKey so the attribute boundary cannot be broken", () => {
    const html = renderUploadPage({ apiKey: "k'with'apos" });
    const match = html.match(/x-data='([^']*)'/);
    expect(match).not.toBeNull();
    // The escaped form &#39; must appear in the attribute value.
    expect(match![1]).toContain("&#39;");
  });
});
