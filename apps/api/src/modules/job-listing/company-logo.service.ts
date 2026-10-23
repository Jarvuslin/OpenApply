import { singleton } from "tsyringe";
import { fetchLogoImage, fetchLogoPage, validatePublicLogoUrl } from "./company-logo-http";
import {
  companyLogoPage,
  isGenericBoardLogo,
  logoCandidatesFromHtml,
} from "./company-logo-metadata";

interface LogoSource {
  companyLogoUrl?: string | null;
  urls: (string | null | undefined)[];
}

@singleton()
export class CompanyLogoService {
  private readonly cache = new Map<string, { expires: number; result: Promise<string | null> }>();
  private readonly images = new Map<string, { expires: number; result: Promise<string | null> }>();

  protected readPage(page: string): ReturnType<typeof fetchLogoPage> {
    return fetchLogoPage(page);
  }

  protected readImage(url: string): Promise<string | null> {
    return fetchLogoImage(url);
  }

  async verifiedImage(value: string): Promise<string | null> {
    const url = validatePublicLogoUrl(value);
    if (!url || isGenericBoardLogo(url)) return null;
    const cached = this.images.get(url);
    if (cached && cached.expires > Date.now()) return cached.result;
    if (this.images.size >= 500) {
      const oldest = this.images.keys().next().value;
      if (oldest) this.images.delete(oldest);
    }
    const entry = {
      expires: Number.POSITIVE_INFINITY,
      result: Promise.resolve<string | null>(null),
    };
    entry.result = this.readImage(url)
      .catch(() => null)
      .then((image) => {
        const safeImage = image && validatePublicLogoUrl(image);
        const logo = safeImage && !isGenericBoardLogo(safeImage) ? safeImage : null;
        entry.expires = Date.now() + (logo ? 86_400_000 : 3_600_000);
        return logo;
      });
    this.images.set(url, entry);
    return entry.result;
  }

  async resolve(source: LogoSource): Promise<string | null> {
    const supplied = source.companyLogoUrl && (await this.verifiedImage(source.companyLogoUrl));
    if (supplied) return supplied;
    const pages = new Set(
      source.urls.flatMap((url) => {
        const page = url && companyLogoPage(url);
        return page ? [page] : [];
      }),
    );
    for (const page of pages) {
      const logo = await this.fromPage(page);
      if (logo) return logo;
    }
    return null;
  }

  private fromPage(page: string): Promise<string | null> {
    const cached = this.cache.get(page);
    if (cached && cached.expires > Date.now()) return cached.result;
    if (this.cache.size >= 500) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    const entry = {
      expires: Number.POSITIVE_INFINITY,
      result: Promise.resolve<string | null>(null),
    };
    entry.result = this.readPage(page)
      .then(async (result) => {
        if (!result) return null;
        for (const candidate of logoCandidatesFromHtml(result.html, result.url)) {
          const logo = await this.verifiedImage(candidate);
          if (logo) return logo;
        }
        return null;
      })
      .catch(() => null)
      .then((logo) => {
        entry.expires = Date.now() + (logo ? 86_400_000 : 3_600_000);
        return logo;
      });
    this.cache.set(page, entry);
    return entry.result;
  }
}
