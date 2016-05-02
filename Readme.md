# GDocsToJSON
by Cathal Garvey, ©2016, released under the GNU AGPLv3

## Preamble: Don't!
I only use Google anything because I am compelled to, for work.
Don't use Google anything if you have any choice in the matter. Your human rights,
including your rights to privacy and free expression, only exist for so long as you
exercise and defend them. Google is the antithesis of these rights, using "gratis"
services to dominate your personal communications and "gratis" spy infrastructure
to convince webmasters around the world to install their surveillance equipment across
the entire internet.

You can take steps to protect yourself from Google's spyware empire, but as long as
you justify them by providing your data and backlinks to them, you are part of the
problem.

So, if you have any choice in the matter, do not use Google Docs, and therefore
don't require yourself to use this tool either. Use a great and truly Free/Libre
office suite like [LibreOffice](https://www.libreoffice.org/). If you require
online-always collaboration software, then [Open356](https://open365.io/) looks
promising, despite the MS-inspired name.

Flex your rights, or lose them.

## What's this?
GDocs provide [JSON output, kinda](https://coderwall.com/p/duapqq/use-a-google-spreadsheet-as-your-json-backend),
in an undocumented way. This is a tool in Python and Go forms that can pull
data from published GDocs sheets and turn it into somewhat cleaner JSON.

This is also a freeboard datasource plugin for same, which was the original
inspiration for the idea. To enable the freeboard plugin, just open the
"Developer Console" and add this plugin script URL:

`https://raw.githubusercontent.com/cathalgarvey/gdocstojson/master/freeboardplugin/freeboardplugin.min.js`

..then add a new datasource and there should be a new option for Google Sheets.
You must publish the sheet online as a HTML file first, from Sheets->File->Publish..,
and doing so will make the raw data technically available to anyone with the URL, and
therefore also anyone who sees the dashboard. So, bear that in mind.

I'm working on a version of this for Ethercalc also; hold out for that for new
or collaborative projects because it's less toxic than Google by a long shot.
Also, unlike Google, it doesn't completely mangle your column headers:
note that field titles are derived from the first line, but
in lowercase with spaces removed. So if the title is "Number of Pets",
the field title in the JSON will be "numberofpets". This is on Google,
not me!

Enjoy, if you must!
