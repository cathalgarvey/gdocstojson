#!/usr/bin/env python3
"""
gdocstojson - by Cathal Garvey, © 2016, released under the GNU AGPLv3.

This is a tool I wrote to take this hack:
https://coderwall.com/p/duapqq/use-a-google-spreadsheet-as-your-json-backend
..and convert the output data into something practical, because as given
it's headache-inducing.

This will probably break on edge-cases, and perhaps even simple things like
some formulas. As usual this comes with no warranties or promises. In my
tiny testing, using straightforward formulas does not affect this, as Google
merely sets the exported value to the calculated value from the sheet. So,
if a cell contains "=sum(A1:A5)" but the visible value is 60, then the value
in the returned JSON will be 60.

Please also note that field titles are derived from the first line, but
in lowercase with spaces removed. So if the title is "Number of Pets",
the field title in the JSON will be "numberofpets". This is on Google,
not me!

This can also be used as a library, either using the single-call entrypoint
or using the component functions (all documented) with your preferred HTTP
library (internally, this uses github.com/cathalgarvey/ultralite for http):

>>> # Use built-in HTTP method to fetch data directly.
>>> # Returns a list of dicts.
>>> data = fetchCleanFeed(myDocsURL)
>>> # Use some other http library and convert the resulting data:
>>> rawData = someHTTPFunc(myDocsURL)
>>> rawJSON = json.loads(rawData)
>>> data = convertFeed(rawJSON)
"""

### Embedding Ultralite for HTTP to remove requests dependency, skip
### down for the googleDocs specific code.
import urllib.request
import urllib.parse
import urllib.error
import http.client
import http.cookiejar
import json

class Ultralite:
    "See: github.com/cathalgarvey/ultralite"

    class UltraliteError(Exception):
        pass

    class UltraliteSSLError(Exception):
        pass

    class UltraliteResponse:
        def __repr__(self):
            return r"UltraliteResponse<'{}', {}>".format(
                self.raw.url, self.status_code)

        def __init__(self, request, response, request_context):
            self.request = request
            self.raw = response
            self.request_context = request_context
            if isinstance(response, http.client.HTTPResponse):
                self.headers = dict(response.getheaders())
                self.status_code = response.status
                self.reason = response.reason
                self.content = response.read()
            elif isinstance(response, urllib.error.HTTPError):
                self.headers = dict(response.headers)
                self.status_code = response.code
                self.reason = response.reason
                self.content = b''
            elif isinstance(response, urllib.error.URLError):
                self.reason = response.reason
                self.status_code = -1
                self.headers = {}
                self.content = b''

        @property
        def cookies(self):
            if not hasattr(self, "_cookiejar"):
                self._cookiejar = http.cookiejar.CookieJar()
                self._cookiejar.extract_cookies(self.raw, self.request)
            return self._cookiejar

        @property
        def cookies_dict(self):
            return dict([(c.name, c.value) for c in self.cookies])

        @property
        def text(self):
            return self.content.decode()

        def json(self):
            return json.loads(self.text)

        def raise_for_status(self):
            if not 200 <= self.status_code <= 299:
                raise Ultralite.UltraliteError(
                    "Status code not in 2XX range: {} - {}".format(
                        self.status_code, self.reason))

        def _ensure_child_ssl(self, url, skip_ssl=False):
            if self.request.using_ssl and (not url.startswith("https")):
                raise Ultralite.UltraliteSSLError(
                    "Chained request using non-SSL on SSL-secured parent!")
            elif (not self.request.using_ssl) and url.startswith("https"):
                raise Ultralite.UltraliteSSLError(
                    "Chained request wants SSL but parent context lacks it!")

        def _chain(self, url, method, *a, **kw):
            self._ensure_child_ssl(url)
            req = Ultralite.construct_request(method, url, *a, **kw)
            req.using_ssl = self.request.using_ssl
            return Ultralite.resolve_call(req, self.request_context)

        def head(self, url, *a, **kw):
            return self._chain(url, 'HEAD', *a, **kw)

        def get(self, url, *a, **kw):
            return self._chain(url, 'GET', *a, **kw)

        def post(self, url, *a, **kw):
            return self._chain(url, 'POST', *a, **kw)

        def put(self, url, *a, **kw):
            return self._chain(url, 'PUT', *a, **kw)

        def delete(self, url, *a, **kw):
            return self._chain(url, 'DELETE', *a, **kw)

    _default_headers = {}

    @classmethod
    def construct_request(self, method, url, *, params=None, headers={}):
        outbound_headers = self._default_headers.copy()
        outbound_headers.update(headers)
        if params is not None:
            url += "?{}".format(urllib.parse.urlencode(params))
        return urllib.request.Request(url, headers=headers, method=method)

    @classmethod
    def create_ssl_handler(self):
        try:
            import ssl
            ssl_context = ssl.create_default_context()
            sslHandler = urllib.request.HTTPSHandler(context=ssl_context)
            return sslHandler
        except Exception as E:
            raise Ultralite.UltraliteSSLError(  # HALT AND CATCH FIRE
                "Failed to establish SSL context: {}".format(E))

    @classmethod
    def call_method(self,
                    method,
                    url,
                    *,
                    headers={},
                    cookies=None,
                    params=None):
        # Construct request separately to context, etcetera; may help
        # when implementing request chaining later on.
        req = self.construct_request(method,
                                     url,
                                     params=params,
                                     headers=headers)
        # Construct handlers
        handlers = []
        if url.startswith("https"):
            # Will raise UltraliteSSLError if it fails to make a handler.
            handlers.append(self.create_ssl_handler())
            req.using_ssl = True
        else:
            req.using_ssl = False
        if cookies is not None:
            if not isinstance(cookies, http.cookiejar.CookieJar):
                raise TypeError("cookies must be a Cookiejar instance.")
            cookiehandler = urllib.request.HTTPCookieProcessor(cookies)
            handlers.append(cookiehandler)
        # Apply handlers
        opener = urllib.request.build_opener(*handlers)
        return self.resolve_call(req, opener)

    @classmethod
    def resolve_call(self, req, opener):
        try:
            resp = opener.open(req)
        except urllib.error.URLError as e:
            resp = e
        except urllib.error.HTTPError as e:
            resp = e
        return Ultralite.UltraliteResponse(req, resp, opener)

    @classmethod
    def get(self, *a, **kw):
        return self.call_method('GET', *a, **kw)

    @classmethod
    def head(self, *a, **kw):
        return self.call_method('HEAD', *a, **kw)

    @classmethod
    def post(self, *a, **kw):
        raise NotImplementedError("I'll get around to this bit.")

    @classmethod
    def put(self, *a, **kw):
        raise NotImplementedError("I'll get around to this bit.")

    @classmethod
    def delete(self, *a, **kw):
        raise NotImplementedError("I'll get around to this bit.")
###
### End of Ultralite code, below is the logic code for GDocsToJSON

import re
ultralite = Ultralite  # Replaces "import requests"

def parseDocCode(url: str)->str:
    "Accept a docs HTML URL, parse out the docs code."
    m = re.match(r"https://docs.google.com/spreadsheets/d/([^/]+)/.+", url)
    if m:
        return m.group(1)
    else:
        raise ValueError("Failed to parse, was expecting URL like 'https://docs.google.com/spreadsheets/d/{{CODE}}/...'")

def feedifyDocURL(docURL: str)->str:
    "Accept a docs HTML URL, return a JSON feedified URL."
    template = "https://spreadsheets.google.com/feeds/list/{code}/od6/public/values?alt=json"
    code = parseDocCode(docURL)
    return template.format(code=code)

def fetchJSONFeed(docURL:str)->dict:
    "Fetch data as JSON after converting URL. Returns messy Google JSON"
    convUrl = feedifyDocURL(docURL)
    r = ultralite.get(convUrl)
    r.raise_for_status()
    return r.json()

def extractDataFromEntry(d: dict)->dict:
    "Converts messy Google JSON row entry into a clean JSON object."
    output = {}
    for k, v in d.items():
        if k.startswith("gsx$"):
            output[k[4:]] = v['$t']
    return output

def convertFeed(feed: dict)->[dict]:
    "Converts messy Google JSON to list of clean key:value objects."
    data = feed['feed']['entry']
    return [extractDataFromEntry(d) for d in data]

def fetchCleanFeed(docUrl:str)->[dict]:
    """
    Fix URL, fetch data, clean it, return list of clean objects for each row.

    May raise ValueError on unexpected URL input, KeyError if the JSON
    format returned by Google changes, or any error raised by requests
    on r.raise_for_status.
    """
    messyFeed = fetchJSONFeed(docUrl)
    cleanFeed = convertFeed(messyFeed)
    return cleanFeed

if __name__ == "__main__":
    import argparse
    P = argparse.ArgumentParser(description="Fetch data from a published googledocs datasheet, clean it up, and return a list of JSON objects for each row.")
    P.add_argument("URL", type=str, help="URL of the published document.")
    args = P.parse_args()
    data = fetchCleanFeed(args.URL)
    print(json.dumps(data, indent=1))
