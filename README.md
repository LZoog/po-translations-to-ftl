
# po-translations-to-ftl

This script was created to help the Firefox Accounts team programmatically migrate existing email translations from [gettext](https://www.npmjs.com/package/node-gettext) `.po` files to [Fluent]((https://www.npmjs.com/package/@fluent/bundle)) `.ftl` files. The original intent was to expand the functionality or make it easy to use elsewhere, but at the time of writing, changes were implemented that are likely specific to FxA / FxA emails.

This tool currently assumes:
* You have a single `.ftl` file with ftl IDs and strings
* The `.po` file where translations will be extracted exist in an `LC_MESSAGES` directory within multiple language directories, e.g. `locale/ar/LC_MESSAGES/my-file.po` and `locale/es/LC_MESSAGES/my-file.po`
* The strings set in your `.ftl` file match the `msgid` in your `.po` files

Known things that won't transfer over properly since we haven't had a use case yet:
* Lines beginning and ending with variables containing copy between, like `%(my-name)s is a cool %(description)s`
* Nested strings with multiple `=` in `.ftl` files, such as:
```
avatar-your-avatar =
  .alt = Your avatar
```

Use at your own risk, as outlined here this is pretty rudimentary and there's almost certainly unaccounted for edge cases.

This has only been tested on a Mac.

## Installation

Simply clone the repo and install:

```
npm install
```

## Usage

Pass in arguments when you run `npm start`.

Arguments:
* `ftlDir` (required, string) - the path to the directory containing the ftl file to be referenced
* `ftlFile` (required, string) - the name of the .ftl file to be referenced
* `localeDir` (required, string) - the path to the locale directory containing language directories, which contain an LC_MESSAGES directory with .po files
* `poFile` (required, string) - the name of the .po file to copy existing translations from
* `trialRun` (optional, boolean, defaults to false) - if set to true, instead of writing all .ftl files to disk, console log the first two to verify they look as expected

Example:
```
npm start -- --ftlDir=../fxa/packages/fxa-auth-server/public/locales/en --ftlFile=auth.ftl --localeDir=../fxa-content-server-l10n/locale --poFile=server.po --trialRun=true
```