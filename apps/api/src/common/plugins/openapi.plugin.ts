import { openapi } from "@elysiajs/openapi";
import { z } from "zod";

export const openapiPlugin = openapi({
  path: "/swagger",
  // Routes validate with Zod (Standard Schema), which the plugin can only document through a mapper.
  mapJsonSchema: { zod: z.toJSONSchema },
  documentation: {
    info: { title: "OpenApply API", version: "2.0.0" },
  },
});
