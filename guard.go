package main

import (
	"fmt"
	"log"
	"runtime/debug"
)

// guard keeps a crash in one background task from closing the app: it
// logs the panic with its stack and lets the task report the failure.
// Wails already does this for calls from the window; goroutines the app
// starts itself need it too. Use as: defer guard("setup", onPanic).
func guard(task string, onPanic func(error)) {
	if e := recover(); e != nil {
		err := fmt.Errorf("%s: panic: %v", task, e)
		log.Printf("%v\n%s", err, debug.Stack())
		if onPanic != nil {
			onPanic(err)
		}
	}
}
