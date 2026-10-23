import { singleton } from "tsyringe";
import { isPrismaError, PRISMA_ERRORS } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeCompanyName } from "@/modules/scoring/applied-duplicates";
import { KNOWN_COMPANIES } from "./company-directory";

export interface CompanyRef {
  id: string;
  name: string;
}

const KNOWN_BY_ALIAS = new Map(
  KNOWN_COMPANIES.flatMap((company) =>
    [company.name, ...(company.aliases ?? [])].map(
      (alias) => [normalizeCompanyName(alias), company] as const,
    ),
  ),
);

/** Every normalized name a known company goes by. */
export function knownAliases(company: (typeof KNOWN_COMPANIES)[number]): string[] {
  return [...new Set([company.name, ...(company.aliases ?? [])].map(normalizeCompanyName))];
}

/** Finds the one company a job belongs to: its board's company, else the company by that name. */
@singleton()
export class CompanyResolver {
  private readonly byBoard = new Map<string, CompanyRef>();
  private readonly byAlias = new Map<string, CompanyRef>();

  constructor(private readonly prisma: PrismaClient) {}

  async resolve(boardKey: string | null | undefined, name: string): Promise<CompanyRef> {
    const board = boardKey?.toLowerCase();
    const cached = board ? this.byBoard.get(board) : undefined;
    if (cached) return cached;
    if (board) {
      const row = await this.prisma.companyBoard.findUnique({
        where: { boardKey: board },
        select: { company: { select: { id: true, name: true } } },
      });
      if (row) return this.remember(board, row.company);
    }
    const company = await this.byName(name);
    if (board) {
      await this.prisma.companyBoard
        .create({ data: { boardKey: board, companyId: company.id } })
        .catch((error: unknown) => {
          if (!isPrismaError(error, PRISMA_ERRORS.UNIQUE_VIOLATION)) throw error;
        });
      this.remember(board, company);
    }
    return company;
  }

  private remember(board: string, company: CompanyRef) {
    this.byBoard.set(board, company);
    return company;
  }

  private async byName(name: string): Promise<CompanyRef> {
    const alias = normalizeCompanyName(name);
    const cached = this.byAlias.get(alias);
    if (cached) return cached;
    const known = KNOWN_BY_ALIAS.get(alias);
    const found = await this.prisma.company.findFirst({
      where: known ? { key: known.domain } : { aliases: { has: alias } },
      select: { id: true, name: true },
    });
    const company =
      found ??
      (await this.create(
        known
          ? {
              key: known.domain,
              domain: known.domain,
              name: known.name,
              aliases: knownAliases(known),
            }
          : { key: `name:${alias}`, name, aliases: [alias] },
      ));
    this.byAlias.set(alias, company);
    return company;
  }

  private async create(data: { key: string; domain?: string; name: string; aliases: string[] }) {
    try {
      return await this.prisma.company.create({ data, select: { id: true, name: true } });
    } catch (error) {
      // Another refresh created it first.
      if (!isPrismaError(error, PRISMA_ERRORS.UNIQUE_VIOLATION)) throw error;
      return this.prisma.company.findUniqueOrThrow({
        where: { key: data.key },
        select: { id: true, name: true },
      });
    }
  }
}
