import { LOGIN_SCOPE, type SaveJobLogin, SERVICE_PROVIDERS } from "@openapply/contracts/credential";
import { singleton } from "tsyringe";
import { CryptoService, SECRET_CONTEXTS } from "@/common/crypto";
import { conflict, forbidden } from "@/common/errors";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { PrismaClient } from "@/generated/prisma/client";

export interface ResolvedCredential {
  /** The credential row - the target of a password change on the Queue page. */
  id: string;
  email: string;
  password: string;
}

@singleton()
export class CredentialService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
  ) {}

  async login(userId: string, authorship: AuthKind) {
    this.human(authorship);
    const rows = await this.prisma.credential.findMany({
      where: { userId, scope: { in: [LOGIN_SCOPE, ...SERVICE_PROVIDERS] } },
      select: { scope: true, email: true, password: true, apiKey: true },
    });
    const login = rows.find((row) => row.scope === LOGIN_SCOPE);
    const captcha = rows.find((row) => row.scope !== LOGIN_SCOPE && row.apiKey?.trim());
    return {
      email: login?.email ?? null,
      hasPassword: !!login?.password?.trim(),
      captchaProvider: (captcha?.scope as (typeof SERVICE_PROVIDERS)[number] | undefined) ?? null,
      hasCaptchaKey: !!captcha,
    };
  }

  async saveLogin(userId: string, authorship: AuthKind, input: SaveJobLogin) {
    this.human(authorship);
    const email = input.email.trim().toLowerCase();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.credential.findUnique({
        where: { userId_scope: { userId, scope: LOGIN_SCOPE } },
        select: { email: true, password: true },
      });
      const sameEmail = existing?.email?.trim().toLowerCase() === email;
      if (!input.password && !(sameEmail && existing?.password))
        throw conflict("Enter the password for this email.");
      const password = input.password
        ? await this.crypto.encryptFor(userId, SECRET_CONTEXTS.credentialPassword, input.password)
        : undefined;
      await tx.credential.upsert({
        where: { userId_scope: { userId, scope: LOGIN_SCOPE } },
        create: { userId, scope: LOGIN_SCOPE, email, password },
        update: { email, ...(password && { password }) },
      });
      const others = SERVICE_PROVIDERS.filter((provider) => provider !== input.captchaProvider);
      await tx.credential.deleteMany({ where: { userId, scope: { in: [...others] } } });
      if (input.captchaProvider) {
        const scope = input.captchaProvider;
        if (input.captchaApiKey) {
          const apiKey = await this.crypto.encryptFor(
            userId,
            SECRET_CONTEXTS.credentialApiKey,
            input.captchaApiKey,
          );
          await tx.credential.upsert({
            where: { userId_scope: { userId, scope } },
            create: { userId, scope, apiKey },
            update: { apiKey },
          });
        } else if (
          !(await tx.credential.findUnique({ where: { userId_scope: { userId, scope } } }))
        )
          throw conflict("Enter the captcha key for this service.");
      }
      // The login email is the one mailbox; select its checked mailbox when one exists.
      const mailbox = await tx.emailAccount.findFirst({
        where: { userId, email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });
      if (mailbox)
        await tx.user.update({ where: { id: userId }, data: { activeEmailAccountId: mailbox.id } });
    });
    return this.login(userId, authorship);
  }

  /** Shows the saved password to its signed-in owner. */
  async revealPassword(userId: string, authorship: AuthKind) {
    this.human(authorship);
    const login = await this.resolveCredential(userId);
    return { password: login?.password ?? null };
  }

  /** The login for every employer site, or null when no complete email + password is saved. */
  async resolveCredential(userId: string): Promise<ResolvedCredential | null> {
    const row = await this.prisma.credential.findUnique({
      where: { userId_scope: { userId, scope: LOGIN_SCOPE } },
      select: { id: true, email: true, password: true },
    });
    const email = row?.email?.trim();
    if (!row || !email || !row.password?.trim()) return null;
    const password = await this.crypto.decryptFor(
      userId,
      SECRET_CONTEXTS.credentialPassword,
      row.password,
    );
    return password.trim() ? { id: row.id, email, password } : null;
  }

  private human(authorship: AuthKind) {
    if (authorship !== "session_user")
      throw forbidden("Use your signed-in OpenApply session to view or change your job login.");
  }
}
