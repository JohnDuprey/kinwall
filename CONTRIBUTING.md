# Contributing to Kinwall

Thanks for helping. Kinwall is a family calendar and organizer for the wall, and every bug report,
docs fix, plugin and pull request makes it better for the families who use it.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug or request a feature** with the [GitHub issue templates](https://github.com/JohnDuprey/kinwall/issues/new/choose).
  Check open issues first, and include steps to reproduce for bugs.
- **Improve the docs.** They live in [`docs/`](docs/) and are plain Markdown. Typos, unclear steps and
  missing screenshots are all fair game.
- **Build an activity plugin.** Start from [kinwall-plugin-hello-world](https://github.com/JohnDuprey/kinwall-plugin-hello-world)
  and read [Building activity plugins](docs/contributing/plugins.md). Plugins live in their own repos.
- **Write code.** Small fixes are welcome as-is. For anything bigger (a new feature, a new setting,
  an API or data change), open an issue first so we can agree on the approach before you build it.

## Getting set up

[Development setup](docs/contributing/development.md) covers Node 24, running the server and UI,
the demo build and the code conventions. [Architecture](docs/contributing/architecture.md) explains
how the pieces fit.

## The essentials

[AGENTS.md](AGENTS.md) is the full rule set for people and AI coding agents alike. The short version:

- **One feature per branch and pull request.**
- **Test first.** A bug gets a test that reproduces it; a feature gets tests for its behavior.
- **`scripts/check.sh` must pass** before you open a pull request.
- **[Conventional Commits](https://www.conventionalcommits.org/)**, e.g. `fix(board): keep the photo from collapsing`.
  CI checks every commit; try a message locally with `echo "feat(x): y" | .github/check-commits.sh`.
- **Docs change with the code.** User-facing changes update `docs/` in the same pull request.
- **Follow the design rules** in [AGENTS.md → Design](AGENTS.md#design): phone, tablet and wall,
  light and dark, touch first, US English.
- **Demo family only** in examples, fixtures and screenshots ("Our Family": Alex, Sam, Maya and Leo).
  Never real names, addresses or photos.
- **Never commit secrets**, API keys or tokens. Tests use obvious fakes.
- **Health data** has strict rules (always encrypted, never logged). See [AGENTS.md → Health data](AGENTS.md#health-data).

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change with its tests and docs.
3. Run `scripts/check.sh`.
4. Open a pull request against `main` that says what changed and why, and links the issue if there is one.
5. CI must be green. A maintainer will review it and may ask for changes.

## License

Kinwall is licensed under [AGPL-3.0-or-later](LICENSE). By contributing, you agree that your
contributions are licensed under the same license. Kinwall builds on a lot of open-source work;
[Credits](docs/contributing/credits.md) lists it.
