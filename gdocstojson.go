package gdocstojson

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"net/http"
	"strings"
)

var (
	// ErrURLParseFailure is returned when parsing of URL fails.
	ErrURLParseFailure = errors.New("Failed to parse JSON Url from Doc URL")
)

// DocURLToJSONURL converts a html doc URL to a JSON URL
func DocURLToJSONURL(url string) string {
	if !strings.HasPrefix(url, "https://docs.google.com/spreadsheets/d/") {
		return ""
	}
	prefLen := len("https://docs.google.com/spreadsheets/d/")
	url = url[prefLen:]
	pathbits := strings.Split(strings.Trim(url, "/"), "/")
	if len(pathbits) == 0 {
		return ""
	}
	return "https://spreadsheets.google.com/feeds/list/" + pathbits[0] + "/od6/public/values?alt=json"
}

// GJSONField is the value type Google returns.
type GJSONField struct {
	V string `json:"$t"`
}

// GJSONEntry is a bar
type GJSONEntry map[string]interface{}

// GJSON is foo
type GJSON struct {
	Feed struct {
		Entry []map[string]interface{} `json:"entry"`
	} `json:"feed"`
}

// JSONFromDocURL takes a doc URL and returns the parsed raw Google-JSON map.
func JSONFromDocURL(docURL string) ([]map[string]interface{}, error) {
	jsonURL := DocURLToJSONURL(docURL)
	if jsonURL == "" {
		return nil, ErrURLParseFailure
	}
	resp, err := http.Get(jsonURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	prelim := new(GJSON)
	prelim.Feed.Entry = make([]map[string]interface{}, 0)
	err = json.Unmarshal(body, &prelim)
	if err != nil {
		return nil, err
	}
	return prelim.Feed.Entry, nil
}

// GetSaneGDocsJSON returns a sanity-preserving
// rearrangement of the raw JSON googledocs provides.
func GetSaneGDocsJSON(htmlDocURL string) ([]map[string]string, error) {
	insaneJSON, err := JSONFromDocURL(htmlDocURL)
	if err != nil {
		return nil, err
	}
	var returned []map[string]string
	for _, row := range insaneJSON {
		re := make(map[string]string)
		for key, gJSONEntry := range row {
			if !strings.HasPrefix(key, "gsx$") {
				continue
			}
			switch gJSONEntry.(type) {
			case map[string]interface{}:
				{
					gJSONMap, ok := gJSONEntry.(map[string]interface{})
					if !ok {
						println("Failed to cast gJSONEntry to map")
						continue
					}
					re[key[4:]] = gJSONMap["$t"].(string)
				}
			default:
			}
		}
		returned = append(returned, re)
	}
	return returned, nil
}
