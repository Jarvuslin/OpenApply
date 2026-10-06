import type { AdminBoardInput, AdminBoardPatch } from "@openapply/contracts/job-board";
import { type PaginationQuery, pageSlice, paginate } from "@openapply/contracts/pagination";
import { singleton } from "tsyringe";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";

/** How many profiles have linked the board - the only thing the catalog view adds to the row. */
const WITH_ADOPTION = { _count: { select: { userBoards: true } } } as const;

type BoardRow = Prisma.JobBoardGetPayload<{ include: typeof WITH_ADOPTION }>;

/**
 * CRUD on the global board catalog. No existence pre-checks - the error middleware already maps
 * Prisma P2002 -> 409 and P2025 -> 404.
 */
@singleton()
export class AdminBoardService {
  constructor(private readonly prisma: PrismaClient) {}

  private project(row: BoardRow) {
    const { _count, ...board } = row;
    return { ...board, adoption: _count.userBoards };
  }

  async list(query: PaginationQuery & { q?: string }) {
    const where: Prisma.JobBoardWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { domain: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.jobBoard.findMany({
        where,
        include: WITH_ADOPTION,
        orderBy: [{ listed: "desc" }, { sortOrder: "asc" }],
        ...pageSlice(query),
      }),
      this.prisma.jobBoard.count({ where }),
    ]);
    return paginate(
      rows.map((row) => this.project(row)),
      query,
      total,
    );
  }

  async create(input: AdminBoardInput) {
    const board = await this.prisma.jobBoard.create({ data: input });
    if (board.isDefault) {
      await this.backfillDefault(board.id);
    }
    return this.read(board.id);
  }

  async update(id: string, input: AdminBoardPatch) {
    const before = await this.prisma.jobBoard.findUniqueOrThrow({
      where: { id },
      select: { isDefault: true },
    });
    await this.prisma.jobBoard.update({ where: { id }, data: input });
    if (!before.isDefault && input.isDefault) {
      await this.backfillDefault(id);
    }
    return this.read(id);
  }

  private async read(id: string) {
    return this.project(
      await this.prisma.jobBoard.findUniqueOrThrow({ where: { id }, include: WITH_ADOPTION }),
    );
  }

  /**
   * A board becoming default links to every existing user here, exactly once. After this moment a
   * missing link means the user removed the board, so nothing may ever re-create it for them.
   */
  private async backfillDefault(jobBoardId: string) {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    await this.prisma.userJobBoard.createMany({
      data: users.map((user) => ({ userId: user.id, jobBoardId })),
      // Races with concurrent signups; whoever wins, the link exists.
      skipDuplicates: true,
    });
  }

  /** Cascades to every profile's link row - the board disappears from those users' boards. */
  async remove(id: string) {
    await this.prisma.jobBoard.delete({ where: { id } });
    return { deleted: id };
  }
}
