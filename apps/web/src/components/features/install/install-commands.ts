import { GITHUB_URL } from "@/lib/constants";
export const RELEASES_URL = "https://api.github.com/repos/Jarvuslin/OpenApply/releases";
export function orderedInstallCommands() {
  return [
    { label: "Clone (GitHub access required)", command: `git clone ${GITHUB_URL}.git` },
    {
      label: "Start after setup (repository root)",
      command: "node scripts/openapply.mjs start",
    },
  ];
}
