import { plainText } from "./types";
import { expect, it } from "bun:test";

it("extracts readable descriptions from escaped employer HTML", () => {
  expect(
    plainText(
      "&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;Build products &amp;amp; APIs.&lt;/p&gt;&lt;/div&gt;",
    ),
  ).toBe("Build products & APIs.");
  expect(
    plainText(
      "<p>Don&#39;t lose C++ &amp; C#.</p><script>track()</script><style>.x { color:red }</style>",
    ),
  ).toBe("Don't lose C++ & C#.");
  expect(plainText("&#x1F680; Engineering &mdash; remote")).toBe("🚀 Engineering — remote");
});
