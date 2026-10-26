import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "dev.mylo.desktop",
  productName: "Mylo Coding Harness",
  electronVersion: "42.3.0",
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  compression: "store",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "package.json"],
  extraResources: [
    {
      from: "resources/icon.png",
      to: "icon.png",
    },
  ],
  asar: true,
  icon: "resources/icon.png",
  mac: {
    extraResources: [{ from: "../../target/release/modus-pty-host", to: "bin/modus-pty-host" }],
    category: "public.app-category.developer-tools",
    icon: "resources/icon.icns",
    target: ["dmg", "zip"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Electron Builder expands these macros.
    artifactName: "Mylo-Coding-Harness-${version}-${arch}-Setup.${ext}",
  },
  win: {
    extraResources: [
      { from: "../../target/release/modus-pty-host.exe", to: "bin/modus-pty-host.exe" },
    ],
    icon: "resources/icon.ico",
    target: ["nsis"],
    signAndEditExecutable: false,
  },
  linux: {
    extraResources: [{ from: "../../target/release/modus-pty-host", to: "bin/modus-pty-host" }],
    category: "Development",
    icon: "resources/icon.png",
    target: ["AppImage", "deb"],
  },
};

export default config;
