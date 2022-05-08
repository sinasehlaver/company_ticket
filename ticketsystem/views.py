from django.http import HttpResponse
from django.shortcuts import render, get_object_or_404, redirect

# Create your views here.
from .forms import EventForm
from .models import *


def index(request):
	return render(request, 'home/index.html')


def hall_index(request):
	halls = Hall.objects.all()
	return render(request, 'hall/index.html', {'halls': halls})


def get_hall(request, hall_id):
	hall = get_object_or_404(Hall, pk=hall_id)
	return render(request, 'hall/detail.html', {'hall': hall})


def event_index(request):
	events = Event.objects.all()
	return render(request, 'event/index.html', {'events': events})


def get_event(request, event_id):
	event = get_object_or_404(Event, pk=event_id)
	return render(request, 'event/detail.html', {'event': event})


def create_event(request):
	if request.method == 'POST':
		form = EventForm(request.POST)
		if form.is_valid():
			event = form.save()
			return redirect('get_event', event.id)
	else:
		form = EventForm()

	return render(request, 'event/create.html', {'form': form})
