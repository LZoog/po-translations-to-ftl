# po-translations-to-ftl

This script was created to help the Firefox Accounts team programmatically migrate existing translations from [gettext](https://www.npmjs.com/package/node-gettext) `.po` files to [Fluent](https://www.npmjs.com/package/@fluent/bundle) `.ftl` files. At the time of writing, it may not be very usable outside of FxA due to there likely being unaccounted for edge cases. This also has only been tested on a Mac.

This tool currently assumes:

- You have a single `.ftl` file with ftl IDs and strings to use as the template base, e.g. `auth.ftl` for FxA
- The `.po` file where translations will be extracted exist in an `LC_MESSAGES` directory within multiple language directories, e.g. `locale/ar/LC_MESSAGES/my-file.po` and `locale/es/LC_MESSAGES/my-file.po`
- The strings set in your `.ftl` file match the `msgid` in your `.po` files

Known things to do:

- Tests would be nice
- If you want to append to existing `.ftl` files (see "Usage"), this tool doesn't currently pick up new brand placeholders/message references (see TODO in code)

## Installation

Simply clone the repo and install:

```
npm install
```

## Usage

Pass in arguments when you run `npm start`.

Arguments:

- `ftlDir` (required, string) - the path to the directory containing the ftl file to be referenced
- `ftlFile` (required, string) - the name of the .ftl file to be referenced
- `localeDir` (required, string) - the path to the locale directory containing language directories, which contain an LC_MESSAGES directory with .po files
- `poFile` (required, string) - the name of the .po file to copy existing translations from
- `otherFtlFile` (optional, string) - The name of an existing .ftl file that may contain translated terms, e.g. "-product-firefox-account", that we can refer to for possible translations. If this is not supplied or no match is found, the English version will be output. Useful for new files.
- `trialRun` (optional, boolean, defaults to false) - if set to true, instead of writing all .ftl files to disk, console log the first two to verify they look as expected

Example:

```
npm start -- --ftlDir=../fxa/packages/fxa-auth-server/public/locales/en --ftlFile=auth.ftl --localeDir=../fxa-content-server-l10n/locale --poFile=server.po --otherFtlFile=settings.ftl --trialRun=true
```

You can use this tool in two ways:

- Generate new `.ftl` files in the locale directory, which occurs if one does not exist
- Append new `.ftl` ID/translation sets to existing `.ftl` files, which occurs if the `localeDir/ftlFile` already exists
