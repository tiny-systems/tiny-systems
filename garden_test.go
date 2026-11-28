package main

import (
	"testing"
)

func TestPresetsSaveReplaceDelete(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	a := &App{}
	if got := a.Presets(); len(got) != 0 {
		t.Fatalf("fresh presets: %v", got)
	}
	if err := a.SavePreset(Preset{Name: "  "}); err == nil {
		t.Error("an empty name should be refused")
	}
	for _, p := range []Preset{{Name: "shop", Repo: "https://github.com/acme/shop"}, {Name: "Big", Memory: "16"}, {Name: "SHOP", Memory: "8"}} {
		if err := a.SavePreset(p); err != nil {
			t.Fatal(err)
		}
	}
	got := a.Presets()
	if len(got) != 2 || got[0].Name != "Big" || got[1].Name != "SHOP" || got[1].Repo != "" || got[1].Memory != "8" {
		t.Fatalf("after saves: %+v", got)
	}
	if err := a.DeletePreset("big"); err != nil {
		t.Fatal(err)
	}
	if got := a.Presets(); len(got) != 1 || got[0].Name != "SHOP" {
		t.Fatalf("after delete: %+v", got)
	}
}

func TestDemoGardenSettingsHoldNoKey(t *testing.T) {
	gs, err := (&App{}).GardenSettings(demoTarget())
	if err != nil || gs.Egress.Mode != "allowlist" || len(gs.Refused) == 0 || gs.Model.Mode != "gateway" {
		t.Fatalf("demo settings: %+v %v", gs, err)
	}
	if err := (&App{}).AllowHost(demoTarget(), "x.org"); err == nil {
		t.Error("the demo garden should refuse changes")
	}
}
