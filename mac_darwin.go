package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework ServiceManagement
#import <Cocoa/Cocoa.h>
#import <ServiceManagement/ServiceManagement.h>
#import <objc/runtime.h>
#include <stdlib.h>

// Clicking the Dock icon brings the window back after it was closed (the
// app keeps running so helpers can still reach you). Wails v2's app
// delegate has no reopen handler, so one is added to its class.
static BOOL tsReopen(id self, SEL _cmd, NSApplication *app, BOOL visible) {
	if (!visible) {
		for (NSWindow *w in app.windows) {
			if ([w canBecomeMainWindow]) { [w makeKeyAndOrderFront:nil]; break; }
		}
		[app activateIgnoringOtherApps:YES];
	}
	return YES;
}

static void tsInstallReopen(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		id d = [NSApp delegate];
		if (d == nil) return;
		SEL sel = @selector(applicationShouldHandleReopen:hasVisibleWindows:);
		char types[16];
		snprintf(types, sizeof types, "%s%s%s%s%s", @encode(BOOL), @encode(id), @encode(SEL), @encode(id), @encode(BOOL));
		class_addMethod([d class], sel, (IMP)tsReopen, types);
	});
}

// The Dock badge: how many helpers are waiting for you.
static void tsSetBadge(const char *s) {
	NSString *label = (s && *s) ? [NSString stringWithUTF8String:s] : nil;
	dispatch_async(dispatch_get_main_queue(), ^{ [[NSApp dockTile] setBadgeLabel:label]; });
}

// Open at login, through macOS's own Login Items (macOS 13+). Returns 0
// when it worked; the error text goes into msg.
// Info.plist already requires 13; the checks keep the compiler honest.
static int tsLoginItem(int on, char *msg, int n) {
	if (@available(macOS 13.0, *)) {
		NSError *err = nil;
		SMAppService *s = [SMAppService mainAppService];
		BOOL ok = on ? [s registerAndReturnError:&err] : [s unregisterAndReturnError:&err];
		if (!ok && err) { snprintf(msg, n, "%s", err.localizedDescription.UTF8String); return 1; }
		return 0;
	}
	snprintf(msg, n, "open at login needs macOS 13 or later");
	return 1;
}

static int tsLoginItemOn(void) {
	if (@available(macOS 13.0, *)) {
		return [SMAppService mainAppService].status == SMAppServiceStatusEnabled;
	}
	return 0;
}
*/
import "C"

import (
	"errors"
	"strconv"
	"unsafe"
)

func installReopen() { C.tsInstallReopen() }

func setDockBadge(n int) {
	s := ""
	if n > 0 {
		s = strconv.Itoa(n)
	}
	cs := C.CString(s)
	defer C.free(unsafe.Pointer(cs))
	C.tsSetBadge(cs)
}

func setLoginItem(on bool) error {
	buf := make([]byte, 256)
	v := C.int(0)
	if on {
		v = 1
	}
	if C.tsLoginItem(v, (*C.char)(unsafe.Pointer(&buf[0])), C.int(len(buf))) != 0 {
		return errors.New("macOS didn't allow it: " + C.GoString((*C.char)(unsafe.Pointer(&buf[0]))))
	}
	return nil
}

func loginItemOn() bool { return C.tsLoginItemOn() != 0 }
