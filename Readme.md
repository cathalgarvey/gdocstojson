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
This is a tool I wrote to take [this hack](https://coderwall.com/p/duapqq/use-a-google-spreadsheet-as-your-json-backend)
and convert the output data into something practical, because as given
it's headache-inducing.

This will probably break on edge-cases, and perhaps even simple things like
some formulas. As usual this comes with no warranties or promises. In my
tiny testing, using straightforward formulas does not affect this, as Google
merely sets the exported value to the calculated value from the sheet. So,
if a cell contains `=sum(A1:A5)` but the visible value is 60, then the value
in the returned JSON will be 60.

Please also note that field titles are derived from the first line, but
in lowercase with spaces removed. So if the title is "Number of Pets",
the field title in the JSON will be "numberofpets". This is on Google,
not me!

This can also be used as a library, either using the single-call entrypoint
or using the component functions (all documented) with your preferred HTTP
library (internally, this uses github.com/cathalgarvey/ultralite for http):

```python
# Use built-in HTTP method to fetch data directly.
# Returns a list of dicts.
data = fetchCleanFeed(myDocsURL)
# Use some other http library and convert the resulting data:
rawData = someHTTPFunc(myDocsURL)
rawJSON = json.loads(rawData)
data = convertFeed(rawJSON)
```

Enjoy, if you must!
