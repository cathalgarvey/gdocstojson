package main

import (
	"github.com/cathalgarvey/gdocstojson"
	"github.com/cathalgarvey/go-freeboard"
	"github.com/gopherjs/gopherjs/js"
)

// GDocsPlugin pulls JSON data from a published Google Docs Sheet.
type GDocsPlugin struct {
	UpdateFunc        func(interface{})
	settings          *js.Object
	closeToKillUpdate chan interface{}
}

// CurrentSettings satisfies the freeboard.DsPlugin interface.
func (gdp *GDocsPlugin) CurrentSettings() *js.Object {
	return gdp.settings
}

// OnSettingsChanged satisfies the freeboard.DsPlugin interface.
func (gdp *GDocsPlugin) OnSettingsChanged(settings *js.Object) {
	gdp.settings = settings
	gdp.UpdateNow()
}

func (gdp *GDocsPlugin) getDocURL() string {
	return gdp.settings.Get("gdocUrl").String()
}

// UpdateNow satisfies the freeboard.DsPlugin interface.
func (gdp *GDocsPlugin) UpdateNow() {
	go func() {
		url := gdp.getDocURL()
		data, err := gdocstojson.GetSaneGDocsJSON(url)
		if err != nil {
			println(err.Error())
		}
		gdp.UpdateFunc(data)
	}()
}

// OnDispose satisfies the freeboard.DsPlugin interface.
func (gdp *GDocsPlugin) OnDispose() {
	close(gdp.closeToKillUpdate)
}

// GDocsPluginDefinition defines a plugin that pulls data from a published GDocs sheet.
var GDocsPluginDefinition = freeboard.DsPluginDefinition{
	TypeName:    "googledocs_sheet",
	DisplayName: "GoogleDocs Sheet",
	Description: "This plugin enables pulling data from a GoogleDocs spreadsheet that has been published as HTML.",
	Settings: []freeboard.FBSetting{
		freeboard.FBSetting{
			Name:        "gdocUrl",
			DisplayName: "HTML URL",
			Description: "URL of the published data as HTML",
			Type:        freeboard.SettingTextType,
		},
		freeboard.FBSetting{
			Name:            "updateInterval",
			DisplayName:     "Update Interval",
			Description:     "How often to update the data source",
			Type:            freeboard.SettingNumberType,
			DefaultIntValue: 60,
		},
	},
	NewInstance: func(settings *js.Object, updateCallback func(interface{})) freeboard.DsPlugin {
		pl := new(GDocsPlugin)
		pl.settings = settings
		pl.UpdateFunc = updateCallback
		updateDuration := settings.Get("updateInterval").Int()
		pl.closeToKillUpdate = freeboard.MakeUpdateTicker(pl, updateDuration)
		return pl
	},
}

func main() {
	println("Registering googledocs plugin")
	freeboard.FB.LoadGoDatasourcePlugin(GDocsPluginDefinition)
}
