// +build !js

package gdocstojson

import (
	"io/ioutil"
	"net/http"
)

// HTTPGet simply uses built-in http calls and ioutils
// to fetch and return a resource. It is the default
// when compiled to Go (but can be overridden), whereas
// when compiled with gopherjs an alternative XHR
// implementation is used. To manually select, set the
// "PreferredGetter" variable to a function with the
// signature func(URL string) (body []byte, error).
func HTTPGet(URL string) ([]byte, error) {
	resp, err := http.Get(URL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return body, nil
}

func init() {
	PreferredGetter = HTTPGet
}
