// +build js

package gdocstojson

import "honnef.co/go/js/xhr"

// XHRGet is the PrefferredGetter in
// JS, wrapping browser XHR APIs instead
// of pulling in huge amounts of crypto
// code just to make simple HTTP requests.
func XHRGet(URL string) ([]byte, error) {
	return xhr.Send("GET", URL, nil)
}

func init() {
	PreferredGetter = XHRGet
}
