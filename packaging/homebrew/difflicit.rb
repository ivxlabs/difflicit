# SPDX-License-Identifier: GPL-3.0-only
# Rendered by .github/workflows/homebrew.yml and pushed to ivxlabs/homebrew-tap as Casks/difflicit.rb.
# __VERSION__ and __SHA256__ are filled in there.
cask "difflicit" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/ivxlabs/difflicit/releases/download/v#{version}/Difflicit_#{version}_universal.dmg"
  name "Difflicit"
  desc "Patch diff anything: compare versions of code and binaries"
  homepage "https://ivx.run/docs/difflicit/"

  # Tauri's default minimum.
  depends_on macos: :high_sierra

  app "Difflicit.app"

  # The app's own settings and caches. Not ~/Difflicit: that's the user's projects.
  zap trash: [
    "~/Library/Application Support/run.ivx.difflicit",
    "~/Library/Caches/run.ivx.difflicit",
    "~/Library/HTTPStorages/run.ivx.difflicit",
    "~/Library/Saved Application State/run.ivx.difflicit.savedState",
    "~/Library/WebKit/run.ivx.difflicit",
  ]

  # Unsigned, like the release downloads: say so rather than stripping the quarantine flag behind the user's back.
  caveats <<~EOS
    This build is not signed or notarised, so macOS refuses it on first launch.
    Either right-click the app and choose Open, or reinstall without the
    quarantine flag:

      brew install --cask --no-quarantine difflicit

    Difflicit diffs with git, binaries with radare2, and dyld shared caches with
    ipsw; install what you need, and an analysis engine such as viper:

      brew install radare2 blacktop/tap/ipsw ivxlabs/tap/viper
  EOS
end
