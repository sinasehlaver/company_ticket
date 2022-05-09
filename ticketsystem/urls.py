from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('hall/', views.hall_index, name='hall_index'),
    path('hall/<int:hall_id>/', views.get_hall, name='get_hall'),
    path('event/', views.event_index, name='event_index'),
    path('event/<int:event_id>/', views.get_event, name='get_event'),
    path('event/add/', views.create_event, name='create_event'),
    path('event/<int:event_id>/add', views.create_day, name='create_event'),
    #path('event/<int:event_id>/<int:>')

]