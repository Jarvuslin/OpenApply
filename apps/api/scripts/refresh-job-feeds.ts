import "reflect-metadata";
import { db } from "../src/common/database/prisma.client";
import { container } from "../src/common/di/container";
import { CatalogRefreshService } from "../src/modules/job-sources/catalog-refresh.service";

try {
  console.log(JSON.stringify(await container.resolve(CatalogRefreshService).refreshDue()));
} finally {
  await db.$disconnect();
}
