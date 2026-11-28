package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
)

// demoChart is the file Fern shows in the demo: a month of checkout-test
// runs by weekday, where only Monday fails.
const demoChart = "/workspace/notes/runs-by-weekday.png"

// demoShown serves the demo garden's shown files.
func demoShown(file string) (ShownFile, error) {
	if file != demoChart {
		return ShownFile{}, fmt.Errorf("no such file in the demo: %s", file)
	}
	data := drawDemoChart()
	return ShownFile{Name: "runs-by-weekday.png", Type: "image/png", Data: base64.StdEncoding.EncodeToString(data), Size: len(data)}, nil
}

// drawDemoChart draws five bars of passing (green) and failing (red) runs.
func drawDemoChart() []byte {
	const w, h = 640, 360
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	fill := func(x0, y0, x1, y1 int, c color.RGBA) {
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				img.SetRGBA(x, y, c)
			}
		}
	}
	bg := color.RGBA{0x14, 0x19, 0x15, 0xff}
	grid := color.RGBA{0x24, 0x2c, 0x26, 0xff}
	pass := color.RGBA{0x46, 0xd8, 0x7a, 0xff}
	fail := color.RGBA{0xef, 0x74, 0x61, 0xff}
	fill(0, 0, w, h, bg)
	base := h - 50
	for i := 0; i <= 4; i++ {
		y := base - i*65
		fill(40, y, w-40, y+1, grid)
	}
	// Runs per weekday: passing on top of failing.
	runs := [][2]int{{0, 12}, {16, 0}, {15, 0}, {17, 0}, {14, 0}}
	bw := 64
	gap := (w - 80 - 5*bw) / 4
	for i, r := range runs {
		x := 40 + i*(bw+gap)
		y := base
		if r[1] > 0 {
			fill(x, y-r[1]*15, x+bw, y, fail)
			y -= r[1] * 15
		}
		if r[0] > 0 {
			fill(x, y-r[0]*15, x+bw, y, pass)
		}
		// A tick under each bar stands in for the day label.
		fill(x+bw/2-10, base+16, x+bw/2+10, base+20, grid)
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}
