
# po-translations-to-ftl

Say your team is migrating from [gettext](https://www.npmjs.com/package/node-gettext) to [Fluent](https://www.npmjs.com/package/@fluent/bundle) and your l10n team already did the work to translate the strings, which exist in a `.po` file in multiple language directories. You've got your newly available `.ftl` file with strings, and you want to port over all the existing `.po` translations to an `.ftl` file in multiple language directories.

Does this oddly specific case apply to you?* Here's the tool for you!

*This tool can of course be expanded further but it was originally created for this specific purpose.

## Installation

Clone the repo and install:

```
npm install
```

## Usage

```
npm start -- --ftlFile=my-file.ftl --localeDir=../fxa-content-server-l10n/locale --poFile=server.po
```